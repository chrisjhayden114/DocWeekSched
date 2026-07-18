import { createOpsCardIfAbsent } from "../cards";
import { prisma } from "../../../db";
import type { DetectorRunResult } from "../types";

export async function detectSessionChanged(
  eventId: string,
  organizationId: string,
  opts?: { jobId?: string | null; now?: Date },
): Promise<DetectorRunResult> {
  const changes = await prisma.sessionScheduleChange.findMany({
    where: { eventId, consumedAt: null },
    orderBy: { createdAt: "asc" },
    take: 50,
    include: {
      session: { select: { id: true, title: true, publishStatus: true } },
    },
  });

  let created = 0;
  let skipped = 0;

  for (const change of changes) {
    if (change.session.publishStatus !== "PUBLISHED") {
      await prisma.sessionScheduleChange.update({
        where: { id: change.id },
        data: { consumedAt: opts?.now || new Date() },
      });
      skipped += 1;
      continue;
    }

    const timeChanged = change.previousStartsAt.getTime() !== change.newStartsAt.getTime();
    const roomChanged = (change.previousRoomId || null) !== (change.newRoomId || null);
    const bits: string[] = [];
    if (timeChanged) bits.push("time");
    if (roomChanged) bits.push("room");
    const what = bits.join(" & ") || "schedule";

    const triggerInstanceKey = `session_change:${change.id}`;
    const { created: didCreate, card } = await createOpsCardIfAbsent(
      {
        organizationId,
        eventId,
        detectorKind: "SESSION_CHANGED",
        triggerInstanceKey,
        triggerSummary: `Published session “${change.session.title}” ${what} changed`,
        evidence: {
          sessionId: change.sessionId,
          scheduleChangeId: change.id,
          previousStartsAt: change.previousStartsAt.toISOString(),
          newStartsAt: change.newStartsAt.toISOString(),
          previousRoomId: change.previousRoomId,
          newRoomId: change.newRoomId,
          links: [{ label: "Session", href: `/session/${change.sessionId}` }],
        },
        draftActionType: "ANNOUNCEMENT",
        draftPayload: {
          audience: "SESSION_JOINERS",
          sessionId: change.sessionId,
          notificationKind: "SESSION_CHANGED",
          sameDaySessionChange: true,
        },
        draftHint: {
          title: `Update: ${change.session.title}`,
          body:
            `The session “${change.session.title}” has a ${what} change. ` +
            `New start: ${change.newStartsAt.toISOString()}. ` +
            `Please check your schedule for the latest details.`,
        },
      },
      { jobId: opts?.jobId },
    );

    await prisma.sessionScheduleChange.update({
      where: { id: change.id },
      data: {
        consumedAt: opts?.now || new Date(),
        opsCardId: card?.id || null,
      },
    });

    if (didCreate) created += 1;
    else skipped += 1;
  }

  return { detectorKind: "SESSION_CHANGED", created, skipped };
}
