import type { PrismaClient } from "@prisma/client";
import { HttpError } from "../authorization";
import { recordSessionScheduleChange } from "../ai/ops/scheduleChange";

export type BulkAssignInput = {
  eventId: string;
  sessionIds: string[];
  /** undefined = leave unchanged; null = clear the assignment. */
  trackId?: string | null;
  roomId?: string | null;
};

/**
 * E16.2 — assign many sessions to a track and/or room in ONE request.
 *
 * Tenancy: every session, and the target track/room, must belong to the
 * given event — ids are never trusted from the client on their own. Room
 * changes on PUBLISHED sessions write the same schedule-change feed rows
 * the single-session PUT does.
 */
export async function bulkAssignSessions(
  prisma: PrismaClient,
  input: BulkAssignInput,
): Promise<{ updatedCount: number }> {
  const sessionIds = [...new Set(input.sessionIds)];
  if (sessionIds.length === 0) {
    throw new HttpError(400, { error: "sessionIds is required" });
  }
  if (input.trackId === undefined && input.roomId === undefined) {
    throw new HttpError(400, { error: "Provide a track and/or room to assign" });
  }

  const sessions = await prisma.session.findMany({
    where: { eventId: input.eventId, id: { in: sessionIds } },
    select: { id: true, roomId: true, publishStatus: true, startsAt: true },
  });
  if (sessions.length !== sessionIds.length) {
    throw new HttpError(400, { error: "One or more sessions are not on this event" });
  }

  if (input.trackId != null) {
    const track = await prisma.track.findFirst({
      where: { id: input.trackId, eventId: input.eventId },
      select: { id: true },
    });
    if (!track) throw new HttpError(400, { error: "Track not found on this event" });
  }
  if (input.roomId != null) {
    const room = await prisma.room.findFirst({
      where: { id: input.roomId, eventId: input.eventId },
      select: { id: true },
    });
    if (!room) throw new HttpError(400, { error: "Room not found on this event" });
  }

  await prisma.$transaction(async (tx) => {
    await tx.session.updateMany({
      where: { id: { in: sessionIds }, eventId: input.eventId },
      data: {
        ...(input.trackId !== undefined ? { trackId: input.trackId } : {}),
        ...(input.roomId !== undefined ? { roomId: input.roomId } : {}),
      },
    });

    if (input.roomId !== undefined) {
      for (const s of sessions) {
        await recordSessionScheduleChange({
          eventId: input.eventId,
          sessionId: s.id,
          publishStatus: s.publishStatus,
          previousStartsAt: s.startsAt,
          newStartsAt: s.startsAt,
          previousRoomId: s.roomId,
          newRoomId: input.roomId ?? null,
          tx,
        });
      }
    }
  });

  return { updatedCount: sessionIds.length };
}
