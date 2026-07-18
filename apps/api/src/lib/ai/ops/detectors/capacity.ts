import { SessionAttendanceStatus, SessionJoinMode } from "@prisma/client";
import { createOpsCardIfAbsent } from "../cards";
import { CAPACITY_PRESSURE_THRESHOLD } from "../types";
import { prisma } from "../../../db";
import type { DetectorRunResult } from "../types";

function intervalsOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export async function detectCapacityPressure(
  eventId: string,
  organizationId: string,
  opts?: { jobId?: string | null; now?: Date },
): Promise<DetectorRunResult> {
  const sessions = await prisma.session.findMany({
    where: {
      eventId,
      publishStatus: "PUBLISHED",
      OR: [{ inPersonCapacity: { not: null } }, { virtualCapacity: { not: null } }],
    },
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      roomId: true,
      allowVirtualJoin: true,
      inPersonCapacity: true,
      virtualCapacity: true,
      attendances: {
        where: { status: SessionAttendanceStatus.JOINING },
        select: { joinMode: true },
      },
      waitlistEntries: {
        where: { promotedAt: null },
        select: { id: true, mode: true },
      },
    },
  });

  const rooms = await prisma.room.findMany({
    where: { eventId, capacity: { not: null } },
    select: { id: true, name: true, capacity: true },
  });

  const allSessionsForRooms = await prisma.session.findMany({
    where: { eventId, publishStatus: "PUBLISHED", roomId: { not: null } },
    select: { id: true, roomId: true, startsAt: true, endsAt: true },
  });

  let created = 0;
  let skipped = 0;

  for (const session of sessions) {
    const modes: Array<{ mode: SessionJoinMode; cap: number | null }> = [
      { mode: SessionJoinMode.IN_PERSON, cap: session.inPersonCapacity },
      { mode: SessionJoinMode.VIRTUAL, cap: session.virtualCapacity },
    ];

    for (const { mode, cap } of modes) {
      if (cap == null || cap <= 0) {
        skipped += 1;
        continue;
      }
      const joined = session.attendances.filter((a) => a.joinMode === mode).length;
      const ratio = joined / cap;
      const waitlistCount = session.waitlistEntries.filter((w) => w.mode === mode).length;

      if (ratio <= CAPACITY_PRESSURE_THRESHOLD || waitlistCount === 0) {
        skipped += 1;
        continue;
      }

      const triggerInstanceKey = `capacity:${session.id}:${mode}`;
      const pct = Math.round(ratio * 100);

      let draftActionType: "ROOM_MOVE" | "OPEN_VIRTUAL" = "OPEN_VIRTUAL";
      let suggestedRoomId: string | null = null;
      let suggestedRoomName: string | null = null;
      let draftHint = {
        title: `Open virtual for ${session.title}`,
        body:
          `“${session.title}” is at ${pct}% ${mode === "IN_PERSON" ? "in-person" : "virtual"} capacity ` +
          `with ${waitlistCount} on the waitlist. Consider enabling or expanding virtual attendance.`,
      };

      if (mode === SessionJoinMode.IN_PERSON) {
        const needed = joined + waitlistCount;
        const candidates = rooms
          .filter((r) => r.id !== session.roomId && (r.capacity || 0) >= needed)
          .filter((r) => {
            const busy = allSessionsForRooms.some(
              (s) =>
                s.id !== session.id &&
                s.roomId === r.id &&
                intervalsOverlap(session.startsAt, session.endsAt, s.startsAt, s.endsAt),
            );
            return !busy;
          })
          .sort((a, b) => (a.capacity || 0) - (b.capacity || 0));

        const best = candidates[0];
        if (best) {
          draftActionType = "ROOM_MOVE";
          suggestedRoomId = best.id;
          suggestedRoomName = best.name;
          draftHint = {
            title: `Move ${session.title} to ${best.name}`,
            body:
              `“${session.title}” is at ${pct}% capacity with ${waitlistCount} waitlisted. ` +
              `Room “${best.name}” (capacity ${best.capacity}) is free in this slot and can fit the demand.`,
          };
        } else if (!session.allowVirtualJoin) {
          draftActionType = "OPEN_VIRTUAL";
        } else {
          // Virtual already open and no larger room — still suggest open/expand note.
          draftActionType = "OPEN_VIRTUAL";
          draftHint = {
            title: `Capacity pressure: ${session.title}`,
            body:
              `“${session.title}” is at ${pct}% with a waitlist. No larger free room found; ` +
              `consider raising capacity or promoting waitlisted attendees when seats free up.`,
          };
        }
      }

      const { created: didCreate } = await createOpsCardIfAbsent(
        {
          organizationId,
          eventId,
          detectorKind: "CAPACITY_PRESSURE",
          triggerInstanceKey,
          triggerSummary: `${session.title} at ${pct}% ${mode} capacity with waitlist (${waitlistCount})`,
          evidence: {
            sessionId: session.id,
            mode,
            joined,
            capacity: cap,
            waitlistCount,
            suggestedRoomId,
            suggestedRoomName,
            links: [{ label: "Session", href: `/session/${session.id}` }],
          },
          draftActionType,
          draftPayload: {
            sessionId: session.id,
            mode,
            suggestedRoomId,
            openVirtual: draftActionType === "OPEN_VIRTUAL",
          },
          draftHint,
        },
        { jobId: opts?.jobId },
      );

      if (didCreate) created += 1;
      else skipped += 1;
    }
  }

  return { detectorKind: "CAPACITY_PRESSURE", created, skipped };
}
