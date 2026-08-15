/**
 * H5 — pick-one timeslot grouping (lib/breakoutSlots).
 *
 * A PD-day shape: timeslots × parallel sessions, attendees pick ONE per
 * slot. These tests pin the grouping rule (day + identical start time,
 * matching the List view), title ordering inside a slot, the isChoice
 * threshold, chosen detection from joined ids, and the default-open-slot
 * policy for mid-event / all-chosen / everything-past nows.
 */

import { describe, expect, it } from "vitest";
import { buildBreakoutSlots, defaultOpenSlotKey } from "../lib/breakoutSlots";

const TZ = "America/New_York";

/** 2026-09-14, times given as EDT (UTC-4). */
function s(id: string, title: string, startEt: string, endEt: string, day = "14") {
  const toIso = (hm: string) => `2026-09-${day}T${hm}:00.000-04:00`;
  return { id, title, startsAt: new Date(toIso(startEt)).toISOString(), endsAt: new Date(toIso(endEt)).toISOString() };
}

/* PD-day fixture: welcome, two choice slots, lunch, plus a day-two slot. */
const WELCOME = s("welcome", "Welcome & coffee", "08:30", "09:00");
const SLOT1 = [
  s("s1c", "Restorative practices", "09:00", "10:15"),
  s("s1a", "Assessment design", "09:00", "10:15"),
  s("s1b", "Math talks", "09:00", "10:15"),
];
const LUNCH = s("lunch", "Lunch", "12:00", "13:00");
const SLOT2 = [
  s("s2b", "Portfolio review", "13:00", "14:15"),
  s("s2a", "Advisory toolkit", "13:00", "14:15"),
];
const DAY2 = [
  s("d2a", "Co-planning studio", "09:00", "10:15", "15"),
  s("d2b", "Family partnerships", "09:00", "10:15", "15"),
];
const ALL = [WELCOME, ...SLOT1, LUNCH, ...SLOT2, ...DAY2];

describe("H5 — buildBreakoutSlots grouping and ordering", () => {
  const slots = buildBreakoutSlots(ALL, new Set(), TZ);

  it("groups by day then identical start time, in chronological order", () => {
    expect(slots.map((slot) => slot.sessions.map((x) => x.id))).toEqual([
      ["welcome"],
      ["s1a", "s1b", "s1c"],
      ["lunch"],
      ["s2a", "s2b"],
      ["d2a", "d2b"],
    ]);
    expect(slots.map((slot) => slot.dayKey)).toEqual([
      "2026-09-14",
      "2026-09-14",
      "2026-09-14",
      "2026-09-14",
      "2026-09-15",
    ]);
  });

  it("sorts sessions inside a slot by title", () => {
    const nineAm = slots[1]!;
    expect(nineAm.sessions.map((x) => x.title)).toEqual([
      "Assessment design",
      "Math talks",
      "Restorative practices",
    ]);
  });

  it("keys each slot by dayKey + startsAt and carries the latest end", () => {
    const nineAm = slots[1]!;
    expect(nineAm.key).toBe(`2026-09-14|${SLOT1[0]!.startsAt}`);
    expect(nineAm.startsAt).toBe(SLOT1[0]!.startsAt);
    expect(nineAm.endsAt).toBe(SLOT1[0]!.endsAt);
    expect(nineAm.dayLabel).toContain("September");
  });

  it("carries a null end when no session in the slot has one", () => {
    const noEnd = buildBreakoutSlots(
      [{ id: "x", title: "X", startsAt: WELCOME.startsAt, endsAt: null }],
      new Set(),
      TZ,
    );
    expect(noEnd[0]!.endsAt).toBeNull();
  });
});

describe("H5 — isChoice threshold", () => {
  const slots = buildBreakoutSlots(ALL, new Set(), TZ);

  it("single-session slots (welcome, lunch) are not choices", () => {
    expect(slots[0]!.isChoice).toBe(false);
    expect(slots[2]!.isChoice).toBe(false);
  });

  it("two or more parallel sessions make a choice slot", () => {
    expect(slots[1]!.isChoice).toBe(true); // 3 options
    expect(slots[3]!.isChoice).toBe(true); // 2 options
  });
});

describe("H5 — chosen detection from joined ids", () => {
  it("marks the joined session in each slot; unjoined slots stay null", () => {
    const slots = buildBreakoutSlots(ALL, new Set(["s1b", "d2a"]), TZ);
    expect(slots[1]!.chosenSessionId).toBe("s1b");
    expect(slots[3]!.chosenSessionId).toBeNull();
    expect(slots[4]!.chosenSessionId).toBe("d2a");
  });
});

describe("H5 — defaultOpenSlotKey", () => {
  it("(a) mid-event now: first future-ending choice slot without a choice", () => {
    // 12:30 ET on day one — slot 1 is over, slot 2 and day two remain.
    const slots = buildBreakoutSlots(ALL, new Set(), TZ);
    const now = new Date("2026-09-14T12:30:00.000-04:00");
    expect(defaultOpenSlotKey(slots, now)).toBe(`2026-09-14|${SLOT2[0]!.startsAt}`);
  });

  it("(a) mid-event now skips slots already chosen", () => {
    const slots = buildBreakoutSlots(ALL, new Set(["s2a"]), TZ);
    const now = new Date("2026-09-14T12:30:00.000-04:00");
    expect(defaultOpenSlotKey(slots, now)).toBe(`2026-09-15|${DAY2[0]!.startsAt}`);
  });

  it("(b) all chosen: null", () => {
    const slots = buildBreakoutSlots(ALL, new Set(["s1a", "s2b", "d2b"]), TZ);
    const now = new Date("2026-09-14T08:00:00.000-04:00");
    expect(defaultOpenSlotKey(slots, now)).toBeNull();
  });

  it("(c) everything past: falls back to the first unchosen choice slot", () => {
    const slots = buildBreakoutSlots(ALL, new Set(["s1c"]), TZ);
    const now = new Date("2026-09-20T09:00:00.000-04:00");
    expect(defaultOpenSlotKey(slots, now)).toBe(`2026-09-14|${SLOT2[0]!.startsAt}`);
  });
});
