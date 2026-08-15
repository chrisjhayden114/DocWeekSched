/**
 * H-GEN — "describe your event, get a suggested agenda" (unit).
 *
 * Covers the params serializer (deterministic, field-complete, matches the
 * committed generated-pd-day fixture byte for byte) and the generate mode of
 * runAgendaExtract under the mock provider: the fixture's skeleton reaches
 * the changeset as grouped create rows with rooms, tracks, and assumptions.
 */

import { describe, expect, it } from "vitest";
import {
  agendaGenParamsSchema,
  loadFixtureExpected,
  loadFixtureSource,
  paramsToSourceText,
  type AgendaGenParams,
} from "../lib/ai/ingest";
import { runAgendaExtract } from "../lib/ai/ingest/extract";
import { MockAiProvider, resetAiProviderForTests } from "../lib/ai";

/** Exactly the parameters the generated-pd-day fixture was serialized from. */
const FIXTURE_PARAMS: AgendaGenParams = agendaGenParamsSchema.parse({
  dayStart: "09:00",
  dayEnd: "15:00",
  lunch: { start: "12:00", end: "13:00" },
  breaks: [],
  rooms: ["Alder Hall", "Birch Room", "Cedar Room"],
  roomCount: null,
  parallelPerSlot: 3,
  sessionMinutes: 75,
  gapMinutes: 15,
  includeWelcome: true,
  breakoutStyle: true,
  notes: "Professional development day. Fingerprint: GENERATED-PD-DAY-FIXTURE-7Q4.",
});

const FIXTURE_EVENT = {
  name: "Pinewood PD Day",
  startDate: "2027-05-20",
  endDate: "2027-05-20",
  timezone: "Europe/London",
};

describe("H-GEN generate params (unit)", () => {
  it("paramsToSourceText is deterministic and reproduces the committed fixture source", () => {
    const first = paramsToSourceText(FIXTURE_PARAMS, FIXTURE_EVENT);
    const second = paramsToSourceText(FIXTURE_PARAMS, FIXTURE_EVENT);
    expect(second).toBe(first);
    expect(first).toBe(loadFixtureSource("generated-pd-day"));
  });

  it("serializes every field as a labeled line", () => {
    const text = paramsToSourceText(
      {
        ...FIXTURE_PARAMS,
        breaks: [
          { start: "10:30", end: "10:45" },
          { start: "15:00", end: "15:15" },
        ],
      },
      FIXTURE_EVENT,
    );
    expect(text.startsWith("EVENT PARAMETERS\n")).toBe(true);
    expect(text).toContain("Event: Pinewood PD Day");
    expect(text).toContain("Timezone: Europe/London");
    expect(text).toContain("Days: 2027-05-20");
    expect(text).toContain("Day start: 09:00");
    expect(text).toContain("Day end: 15:00");
    expect(text).toContain("Lunch: 12:00-13:00");
    expect(text).toContain("Breaks: 10:30-10:45; 15:00-15:15");
    expect(text).toContain("Rooms: Alder Hall; Birch Room; Cedar Room");
    expect(text).toContain("Parallel sessions per slot: 3");
    expect(text).toContain("Session length minutes: 75");
    expect(text).toContain("Gap minutes: 15");
    expect(text).toContain("Include welcome block: yes");
    expect(text).toContain("Breakout style (attendees pick one session per timeslot): yes");
    expect(text).toContain(
      "Notes: Professional development day. Fingerprint: GENERATED-PD-DAY-FIXTURE-7Q4.",
    );
  });

  it("lists every event day inclusive and falls back honestly on lunch/breaks/rooms/notes", () => {
    const text = paramsToSourceText(
      {
        ...FIXTURE_PARAMS,
        lunch: null,
        breaks: [],
        rooms: [],
        roomCount: 4,
        notes: undefined,
      },
      { ...FIXTURE_EVENT, startDate: "2027-06-01", endDate: "2027-06-03" },
    );
    expect(text).toContain("Days: 2027-06-01, 2027-06-02, 2027-06-03");
    expect(text).toContain("Lunch: none");
    expect(text).toContain("Breaks: none");
    expect(text).toContain('Rooms: 4 rooms (unnamed — use "Room 1".."Room 4")');
    expect(text).toContain("Notes: none");
  });

  it("agendaGenParamsSchema enforces the form's bounds", () => {
    const valid = agendaGenParamsSchema.safeParse({
      dayStart: "09:00",
      dayEnd: "17:00",
      rooms: [],
      parallelPerSlot: 2,
      sessionMinutes: 60,
      gapMinutes: 15,
      includeWelcome: true,
      breakoutStyle: false,
    });
    expect(valid.success).toBe(true);

    const bad = (patch: Record<string, unknown>) =>
      agendaGenParamsSchema.safeParse({
        dayStart: "09:00",
        dayEnd: "17:00",
        rooms: [],
        parallelPerSlot: 2,
        sessionMinutes: 60,
        gapMinutes: 15,
        includeWelcome: true,
        breakoutStyle: false,
        ...patch,
      }).success;

    expect(bad({ dayStart: "9am" })).toBe(false);
    expect(bad({ dayEnd: "25:00" })).toBe(false);
    expect(bad({ parallelPerSlot: 0 })).toBe(false);
    expect(bad({ parallelPerSlot: 41 })).toBe(false);
    expect(bad({ sessionMinutes: 10 })).toBe(false);
    expect(bad({ sessionMinutes: 300 })).toBe(false);
    expect(bad({ gapMinutes: 61 })).toBe(false);
    expect(bad({ breaks: Array(5).fill({ start: "10:00", end: "10:15" }) })).toBe(false);
    expect(bad({ notes: "x".repeat(2001) })).toBe(false);
  });

  it("generate mode drafts the fixture skeleton into create rows with slots, rooms, and assumptions", async () => {
    process.env.AI_PROVIDER = "mock";
    resetAiProviderForTests(new MockAiProvider());

    const source = loadFixtureSource("generated-pd-day");
    const expected = loadFixtureExpected("generated-pd-day");
    const result = await runAgendaExtract({
      organizationId: "org_test",
      eventId: "evt_test",
      sourceText: source,
      eventTimezone: "Europe/London",
      eventDates: { start: "2027-05-20", end: "2027-05-20" },
      existingSessions: [],
      mode: "generate",
      skipCap: true,
      skipMetering: true,
      skipAudit: true,
    });

    expect(result.fixtureId).toBe("generated-pd-day");
    expect(result.changeset).toHaveLength(expected.sessions.length);
    expect(result.changeset.every((r) => r.kind === "create")).toBe(true);

    const creates = result.changeset.filter((r) => r.kind === "create");
    const titles = creates.map((r) => (r.kind === "create" ? r.session.title : ""));
    expect(titles[0]).toBe("Welcome");
    expect(titles).toContain("Lunch");

    const lunch = creates.find((r) => r.kind === "create" && r.session.title === "Lunch");
    if (lunch?.kind !== "create") throw new Error("expected lunch create row");
    expect(lunch.session.track).toBe("Breaks");
    expect(lunch.session.startTime).toBe("12:00");
    expect(lunch.session.endTime).toBe("13:00");

    // Slot/room structure survives to the changeset: B2 = second slot,
    // second room.
    const b2 = creates.find(
      (r) => r.kind === "create" && r.session.title === "Session B2 — title TBC",
    );
    if (b2?.kind !== "create") throw new Error("expected B2 create row");
    expect(b2.session.startTime).toBe("10:45");
    expect(b2.session.endTime).toBe("12:00");
    expect(b2.session.room).toBe("Birch Room");
    expect(b2.session.track).toBe("Programme");
    expect(b2.session.speakers).toEqual([]);

    // Every placeholder slot cycles the named rooms; no invented speakers.
    const placeholders = creates.filter(
      (r) => r.kind === "create" && / — title TBC$/.test(r.session.title),
    );
    expect(placeholders).toHaveLength(9);
    expect(
      placeholders.every(
        (r) =>
          r.kind === "create" &&
          ["Alder Hall", "Birch Room", "Cedar Room"].includes(r.session.room || "") &&
          r.session.speakers.length === 0,
      ),
    ).toBe(true);

    // Structural choices are recorded as assumptions, not silently applied.
    const ids = result.assumptions.map((a) => a.id);
    expect(ids).toContain("welcome-length");
    expect(ids).toContain("slot-layout");
    expect(ids).toContain("room-cycle");
    expect(ids).toContain("breakout-style");
  });
});
