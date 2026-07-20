import type { Prisma } from "@prisma/client";
import { prisma } from "../../db";

/** Write a schedule-change feed row when a PUBLISHED session's time or room changes. */
export async function recordSessionScheduleChange(input: {
  eventId: string;
  sessionId: string;
  publishStatus: string;
  previousStartsAt: Date;
  newStartsAt: Date;
  previousRoomId: string | null;
  newRoomId: string | null;
  tx?: Prisma.TransactionClient;
}): Promise<{ id: string } | null> {
  if (input.publishStatus !== "PUBLISHED") return null;
  const timeChanged = input.previousStartsAt.getTime() !== input.newStartsAt.getTime();
  const roomChanged = (input.previousRoomId || null) !== (input.newRoomId || null);
  if (!timeChanged && !roomChanged) return null;

  const db = input.tx || prisma;
  const row = await db.sessionScheduleChange.create({
    data: {
      eventId: input.eventId,
      sessionId: input.sessionId,
      previousStartsAt: input.previousStartsAt,
      newStartsAt: input.newStartsAt,
      previousRoomId: input.previousRoomId,
      newRoomId: input.newRoomId,
      publishStatusAtChange: input.publishStatus,
    },
  });
  return { id: row.id };
}
