import { SessionAttendanceStatus } from "@prisma/client";
import { createOpsCardIfAbsent } from "../cards";
import {
  LOW_CHECKIN_LEAD_MINUTES,
  LOW_CHECKIN_THRESHOLD,
  LOW_CHECKIN_WINDOW_MINUTES,
} from "../types";
import { prisma } from "../../../db";
import type { DetectorRunResult } from "../types";

/** Sessions whose start falls in [now+lead-width/2, now+lead+width/2] ≈ 30 min out. */
export function lowCheckinWindow(
  now: Date,
  leadMinutes = LOW_CHECKIN_LEAD_MINUTES,
  widthMinutes = LOW_CHECKIN_WINDOW_MINUTES,
): { from: Date; to: Date } {
  const center = new Date(now.getTime() + leadMinutes * 60_000);
  const half = (widthMinutes * 60_000) / 2;
  return { from: new Date(center.getTime() - half), to: new Date(center.getTime() + half) };
}

export async function detectLowCheckin(
  eventId: string,
  organizationId: string,
  opts?: { jobId?: string | null; now?: Date },
): Promise<DetectorRunResult> {
  const now = opts?.now || new Date();
  const { from, to } = lowCheckinWindow(now);

  const sessions = await prisma.session.findMany({
    where: {
      eventId,
      publishStatus: "PUBLISHED",
      startsAt: { gte: from, lt: to },
    },
    select: {
      id: true,
      title: true,
      startsAt: true,
      attendances: {
        where: { status: SessionAttendanceStatus.JOINING },
        select: { userId: true },
      },
    },
  });

  let created = 0;
  let skipped = 0;

  for (const session of sessions) {
    const joined = session.attendances.length;
    if (joined === 0) {
      skipped += 1;
      continue;
    }

    const joinerIds = session.attendances.map((a) => a.userId);
    const checkedIn = await prisma.checkIn.count({
      where: { eventId, userId: { in: joinerIds } },
    });
    const ratio = checkedIn / joined;

    if (ratio >= LOW_CHECKIN_THRESHOLD) {
      skipped += 1;
      continue;
    }

    const pct = Math.round(ratio * 100);
    const triggerInstanceKey = `low_checkin:${session.id}:${session.startsAt.toISOString()}`;

    const { created: didCreate } = await createOpsCardIfAbsent(
      {
        organizationId,
        eventId,
        detectorKind: "LOW_CHECKIN",
        triggerInstanceKey,
        triggerSummary: `Low check-in (${pct}% of ${joined} joined) 30 min before “${session.title}”`,
        evidence: {
          sessionId: session.id,
          joined,
          checkedIn,
          ratio,
          startsAt: session.startsAt.toISOString(),
          links: [{ label: "Session", href: `/session/${session.id}` }],
        },
        draftActionType: "ANNOUNCEMENT",
        draftPayload: {
          audience: "SESSION_JOINERS",
          sessionId: session.id,
          notificationKind: "SESSION_STARTING_SOON",
        },
        draftHint: {
          title: `Reminder: ${session.title} starts soon`,
          body:
            `You're joined for “${session.title}”, which starts in about 30 minutes. ` +
            `Please check in when you arrive so we know you're here.`,
        },
      },
      { jobId: opts?.jobId },
    );

    if (didCreate) created += 1;
    else skipped += 1;
  }

  return { detectorKind: "LOW_CHECKIN", created, skipped };
}
