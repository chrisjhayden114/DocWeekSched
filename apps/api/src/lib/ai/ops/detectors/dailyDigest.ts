import { SessionAttendanceStatus } from "@prisma/client";
import { createOpsCardIfAbsent } from "../cards";
import { eventLocalMorningDigestKey, isEventCalendarDay, isEventLocalMorning } from "../time";
import { prisma } from "../../../db";
import type { DetectorRunResult } from "../types";

export async function detectDailyDigest(
  eventId: string,
  organizationId: string,
  opts?: { jobId?: string | null; now?: Date; force?: boolean },
): Promise<DetectorRunResult> {
  const now = opts?.now || new Date();
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      name: true,
      startDate: true,
      endDate: true,
      timezone: true,
    },
  });
  if (!event) return { detectorKind: "DAILY_DIGEST", created: 0, skipped: 0 };

  if (!isEventCalendarDay(now, event)) {
    return { detectorKind: "DAILY_DIGEST", created: 0, skipped: 0 };
  }
  if (!opts?.force && !isEventLocalMorning(now, event.timezone)) {
    return { detectorKind: "DAILY_DIGEST", created: 0, skipped: 0 };
  }

  const dayKey = eventLocalMorningDigestKey(now, event);
  const triggerInstanceKey = `daily_digest:${eventId}:${dayKey}`;

  const startDay = new Date(event.startDate);
  const dayIndex =
    Math.floor(
      (Date.parse(dayKey + "T12:00:00Z") - Date.parse(startDay.toISOString().slice(0, 10) + "T12:00:00Z")) /
        86_400_000,
    ) + 1;

  const memberCount = await prisma.eventMembership.count({
    where: { eventId, deletedAt: null },
  });
  const checkInCount = await prisma.checkIn.count({ where: { eventId } });
  const checkInPct = memberCount > 0 ? Math.round((checkInCount / memberCount) * 100) : 0;

  const unanswered = await prisma.sessionDiscussionThread.count({
    where: {
      answeredAt: null,
      hiddenAt: null,
      session: { eventId },
    },
  });

  const fullSessions = await prisma.session.findMany({
    where: {
      eventId,
      publishStatus: "PUBLISHED",
      inPersonCapacity: { not: null },
    },
    select: {
      title: true,
      inPersonCapacity: true,
      attendances: {
        where: { status: SessionAttendanceStatus.JOINING, joinMode: "IN_PERSON" },
        select: { id: true },
      },
    },
  });
  const fullTitles = fullSessions
    .filter((s) => s.inPersonCapacity && s.attendances.length >= s.inPersonCapacity)
    .map((s) => s.title)
    .slice(0, 3);

  const fullLine = fullTitles.length ? fullTitles.join(", ") : "none at capacity";
  const summary =
    `Day ${Math.max(1, dayIndex)}: ${checkInPct}% check-in, ${unanswered} unanswered questions` +
    (fullTitles.length ? `, ${fullTitles[0]} full` : "");

  const { created: didCreate } = await createOpsCardIfAbsent(
    {
      organizationId,
      eventId,
      detectorKind: "DAILY_DIGEST",
      triggerInstanceKey,
      triggerSummary: summary,
      evidence: {
        dayKey,
        dayIndex: Math.max(1, dayIndex),
        checkInPct,
        checkInCount,
        memberCount,
        unanswered,
        fullSessions: fullTitles,
      },
      draftActionType: "DIGEST_NOTE",
      draftPayload: { dayKey, acknowledgeOnly: true },
      draftHint: {
        title: `Morning digest — Day ${Math.max(1, dayIndex)}`,
        body:
          `${summary}. Full sessions: ${fullLine}. ` +
          `Review the Ops Inbox for anything that needs a send today.`,
      },
    },
    { jobId: opts?.jobId },
  );

  return {
    detectorKind: "DAILY_DIGEST",
    created: didCreate ? 1 : 0,
    skipped: didCreate ? 0 : 1,
  };
}
