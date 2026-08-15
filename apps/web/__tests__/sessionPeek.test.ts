import { describe, expect, it } from "vitest";
import { peekMeta, peekSpeakers } from "../lib/sessionPeek";

/** H4 — the peek sheet's time·room·track line. */

const base = {
  startsAt: "2026-06-08T13:00:00.000Z",
  endsAt: "2026-06-08T14:30:00.000Z",
};

describe("peekMeta", () => {
  it("joins time range, room, and track with middots", () => {
    const line = peekMeta(
      { ...base, room: { name: "Room 204" }, track: { name: "Leadership" } },
      "America/New_York",
    );
    expect(line).toBe("Mon, Jun 8 · 9:00 AM – 10:30 AM EDT · Room 204 · Leadership");
  });

  it("drops missing room and track instead of leaving dangling separators", () => {
    const line = peekMeta({ ...base, room: null, track: null }, "UTC");
    expect(line).toBe("Mon, Jun 8 · 1:00 PM – 2:30 PM UTC");
    expect(line).not.toContain("· ·");
  });

  it("falls back to the free-text location when there is no linked room", () => {
    const line = peekMeta({ ...base, location: "Main Hall" }, "UTC");
    expect(line).toContain("· Main Hall");
  });
});

describe("peekSpeakers", () => {
  it("prefers the free-text speakers field, then the linked speaker, then empty", () => {
    expect(peekSpeakers({ speakers: "Dr. A, Dr. B", speaker: { name: "Dr. C" } })).toBe("Dr. A, Dr. B");
    expect(peekSpeakers({ speakers: "  ", speaker: { name: "Dr. C" } })).toBe("Dr. C");
    expect(peekSpeakers({})).toBe("");
  });
});
