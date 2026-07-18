import { prisma } from "../../db";

/** True if [aStart,aEnd) overlaps [bStart,bEnd). */
export function intervalsOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export type BusyInterval = { startsAt: Date; endsAt: Date };

export async function loadBusyIntervals(eventId: string, userId: string): Promise<BusyInterval[]> {
  const [attendances, blocks] = await Promise.all([
    prisma.sessionAttendance.findMany({
      where: {
        userId,
        status: "JOINING",
        session: { eventId },
      },
      select: {
        session: { select: { startsAt: true, endsAt: true } },
      },
    }),
    prisma.personalAgendaBlock.findMany({
      where: { eventId, userId },
      select: { startsAt: true, endsAt: true },
    }),
  ]);

  const out: BusyInterval[] = [];
  for (const a of attendances) {
    out.push({ startsAt: a.session.startsAt, endsAt: a.session.endsAt });
  }
  for (const b of blocks) {
    out.push({ startsAt: b.startsAt, endsAt: b.endsAt });
  }
  return out;
}

function isFree(busy: BusyInterval[], start: Date, end: Date): boolean {
  return !busy.some((b) => intervalsOverlap(start, end, b.startsAt, b.endsAt));
}

/**
 * Propose up to `count` 30-minute slots during the event that are free for BOTH users.
 * Scans event window in 30-minute steps during daytime hours (09:00–18:00 event-local approximated via UTC steps).
 */
export async function findMutuallyFreeSlots(input: {
  eventId: string;
  userAId: string;
  userBId: string;
  count?: number;
  slotMinutes?: number;
}): Promise<Array<{ startsAt: string; endsAt: string }>> {
  const count = input.count ?? 2;
  const slotMs = (input.slotMinutes ?? 30) * 60_000;

  const event = await prisma.event.findUnique({
    where: { id: input.eventId },
    select: { startDate: true, endDate: true },
  });
  if (!event) return [];

  const [busyA, busyB] = await Promise.all([
    loadBusyIntervals(input.eventId, input.userAId),
    loadBusyIntervals(input.eventId, input.userBId),
  ]);

  const found: Array<{ startsAt: string; endsAt: string }> = [];
  const cursor = new Date(event.startDate);
  // Align to next half-hour
  const mins = cursor.getUTCMinutes();
  cursor.setUTCMinutes(mins < 30 ? 30 : 60, 0, 0);

  const end = event.endDate.getTime();
  while (cursor.getTime() + slotMs <= end && found.length < count) {
    const hour = cursor.getUTCHours();
    if (hour >= 9 && hour < 18) {
      const slotEnd = new Date(cursor.getTime() + slotMs);
      if (isFree(busyA, cursor, slotEnd) && isFree(busyB, cursor, slotEnd)) {
        found.push({
          startsAt: cursor.toISOString(),
          endsAt: slotEnd.toISOString(),
        });
      }
    }
    cursor.setTime(cursor.getTime() + slotMs);
  }

  return found;
}

/** Pure helper for tests — given busy lists, return first N free slots in a window. */
export function pickMutuallyFreeSlots(input: {
  windowStart: Date;
  windowEnd: Date;
  busyA: BusyInterval[];
  busyB: BusyInterval[];
  count?: number;
  slotMinutes?: number;
}): Array<{ startsAt: Date; endsAt: Date }> {
  const count = input.count ?? 2;
  const slotMs = (input.slotMinutes ?? 30) * 60_000;
  const found: Array<{ startsAt: Date; endsAt: Date }> = [];
  const cursor = new Date(input.windowStart);
  while (cursor.getTime() + slotMs <= input.windowEnd.getTime() && found.length < count) {
    const slotEnd = new Date(cursor.getTime() + slotMs);
    if (isFree(input.busyA, cursor, slotEnd) && isFree(input.busyB, cursor, slotEnd)) {
      found.push({ startsAt: new Date(cursor), endsAt: slotEnd });
    }
    cursor.setTime(cursor.getTime() + slotMs);
  }
  return found;
}
