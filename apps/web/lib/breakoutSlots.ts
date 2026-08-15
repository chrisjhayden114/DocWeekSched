/**
 * H5 (DESIGN_PHASE_H D5 + D7) — pick-one timeslot grouping for
 * breakout-style events.
 *
 * Pure logic for the BreakoutSlotBoard: group the (already filtered)
 * schedule into timeslots by day + identical start time — the same
 * grouping rule the List view uses — and decide which slot the accordion
 * should open by default.
 */

import { zonedDayKey } from "./eventTimezone";

/** Structural session shape — dashboard's Session satisfies it. */
export type BreakoutSlotSession = {
  id: string;
  title: string;
  startsAt: string;
  endsAt?: string | null;
};

export type BreakoutSlot<T extends BreakoutSlotSession = BreakoutSlotSession> = {
  /** dayKey + startsAt of the slot's first session. */
  key: string;
  dayKey: string;
  dayLabel: string;
  startsAt: string;
  /** Latest end among the slot's sessions; null when none carries one. */
  endsAt: string | null;
  /** Sorted by title. */
  sessions: T[];
  /** From the joined ids — the one session in this slot I'm joining. */
  chosenSessionId: string | null;
  /** ≥2 parallel sessions = a real choice; single rows render minimal. */
  isChoice: boolean;
};

/** Same start-time key the List view groups by (wall clock in timeZone). */
function slotTimeKey(startsAt: string, timeZone: string): string {
  return new Date(startsAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
}

export function buildBreakoutSlots<T extends BreakoutSlotSession>(
  sessions: T[],
  joiningIds: Set<string>,
  timeZone: string,
): BreakoutSlot<T>[] {
  const ordered = [...sessions].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );

  // Insertion order is chronological because `ordered` is.
  const groups = new Map<string, T[]>();
  for (const session of ordered) {
    const dayKey = zonedDayKey(session.startsAt, timeZone);
    const groupKey = `${dayKey}|${slotTimeKey(session.startsAt, timeZone)}`;
    const list = groups.get(groupKey) || [];
    list.push(session);
    groups.set(groupKey, list);
  }

  return [...groups.values()].map((slotSessions) => {
    const first = slotSessions[0]!;
    const dayKey = zonedDayKey(first.startsAt, timeZone);
    const dayLabel = new Date(first.startsAt).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      timeZone,
    });
    const endTimes = slotSessions
      .map((s) => s.endsAt)
      .filter((e): e is string => Boolean(e))
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
    const sorted = [...slotSessions].sort((a, b) => a.title.localeCompare(b.title));
    return {
      key: `${dayKey}|${first.startsAt}`,
      dayKey,
      dayLabel,
      startsAt: first.startsAt,
      endsAt: endTimes.length ? endTimes[endTimes.length - 1]! : null,
      sessions: sorted,
      chosenSessionId: sorted.find((s) => joiningIds.has(s.id))?.id ?? null,
      isChoice: sorted.length >= 2,
    };
  });
}

/**
 * Which slot the accordion opens by default: the first choice slot still
 * ahead of `now` without a choice; else the first unchosen choice slot at
 * all; else null (everything is chosen).
 */
export function defaultOpenSlotKey(slots: BreakoutSlot[], now: Date): string | null {
  const unchosen = slots.filter((s) => s.isChoice && !s.chosenSessionId);
  const upcoming = unchosen.find(
    (s) => new Date(s.endsAt ?? s.startsAt).getTime() > now.getTime(),
  );
  return upcoming?.key ?? unchosen[0]?.key ?? null;
}
