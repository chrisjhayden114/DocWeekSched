/**
 * AGENDA-2 — the shared agenda filter model.
 *
 * Both attendee agendas run through `filterSessions`, so this is the one place
 * that can guarantee a shared link resolves to the same sessions whether the
 * person who opens it is signed in or not. The matrix below covers each field
 * once and then the two combination rules that are easy to get backwards:
 * OR within a group, AND across groups.
 */

import { describe, expect, it } from "vitest";
import {
  EMPTY_AGENDA_FILTERS,
  activeFilterCount,
  clearAgendaFilters,
  filterSessions,
  filtersFromQuery,
  filtersToQuery,
  groupKeyCoverage,
  hasSessionMaterials,
  isGroupFilterable,
  optionCounts,
  printCountLine,
  sessionSpeakerKeys,
  toggleFilterValue,
  type AgendaFilters,
  type FilterableSession,
} from "../lib/agendaFilters";

/** Day keys are just the ISO date here — the timezone maths is tested elsewhere. */
const ctx = { dayKey: (iso: string) => iso.slice(0, 10) };

function session(over: Partial<FilterableSession> & { id: string }): FilterableSession {
  return {
    title: `Session ${over.id}`,
    startsAt: "2026-06-08T09:00:00.000Z",
    endsAt: "2026-06-08T10:00:00.000Z",
    ...over,
  };
}

/*
 * A small program with a deliberate shape:
 *   day 1: a keynote (Hall A, Maya), two workshops (Room 12 / Room 14),
 *          a break with no track and no speaker
 *   day 2: a panel (Hall A, Maya + Jonas) with a recording
 */
const program: FilterableSession[] = [
  session({
    id: "keynote",
    title: "Opening keynote",
    format: "keynote",
    trackId: "t-keynote",
    roomId: "r-hall",
    sessionSpeakers: [{ speaker: { id: "maya", name: "Maya Chen" } }],
    fileUrl: "/slides/keynote.pdf",
  }),
  session({
    id: "w1",
    title: "Reading conferences",
    format: "workshop",
    trackId: "t-workshops",
    roomId: "r-12",
    sessionSpeakers: [{ speaker: { id: "elena", name: "Elena Ruiz" } }],
  }),
  session({
    id: "w2",
    title: "Small-group math routines",
    format: "workshop",
    trackId: "t-workshops",
    roomId: "r-14",
    sessionSpeakers: [{ speaker: { id: "jonas", name: "Jonas Okonkwo" } }],
    fileLink: "https://example.com/handout",
  }),
  session({
    id: "break",
    title: "Coffee and registration",
    format: "break",
    roomId: "r-hall",
  }),
  session({
    id: "panel",
    title: "Closing roundtable",
    startsAt: "2026-06-09T09:00:00.000Z",
    endsAt: "2026-06-09T10:00:00.000Z",
    format: "panel",
    trackId: "t-keynote",
    roomId: "r-hall",
    sessionSpeakers: [
      { speaker: { id: "maya", name: "Maya Chen" } },
      { speaker: { id: "jonas", name: "Jonas Okonkwo" } },
    ],
    recordingUrl: "https://example.com/recording",
  }),
];

function ids(filters: Partial<AgendaFilters>, context = ctx): string[] {
  return filterSessions(program, { ...EMPTY_AGENDA_FILTERS, ...filters }, context).map((s) => s.id);
}

describe("filterSessions — one field at a time", () => {
  it("returns the whole program when nothing is set", () => {
    expect(ids({})).toEqual(["keynote", "w1", "w2", "break", "panel"]);
  });

  it("filters by day", () => {
    expect(ids({ dayKey: "2026-06-08" })).toEqual(["keynote", "w1", "w2", "break"]);
    expect(ids({ dayKey: "2026-06-09" })).toEqual(["panel"]);
  });

  it("filters by format", () => {
    expect(ids({ formats: ["workshop"] })).toEqual(["w1", "w2"]);
    expect(ids({ formats: ["break"] })).toEqual(["break"]);
  });

  it("filters by track, and a session with no track is never a match", () => {
    expect(ids({ trackIds: ["t-workshops"] })).toEqual(["w1", "w2"]);
    // The break has trackId undefined; an empty key must not match anything.
    expect(ids({ trackIds: [""] })).toEqual([]);
  });

  it("filters by room", () => {
    expect(ids({ roomIds: ["r-hall"] })).toEqual(["keynote", "break", "panel"]);
  });

  it("filters by speaker", () => {
    expect(ids({ speakerId: "maya" })).toEqual(["keynote", "panel"]);
    expect(ids({ speakerId: "elena" })).toEqual(["w1"]);
    expect(ids({ speakerId: "nobody" })).toEqual([]);
  });

  it("filters by materials — any of fileUrl, fileLink, or recordingUrl", () => {
    expect(ids({ hasMaterials: true })).toEqual(["keynote", "w2", "panel"]);
  });

  it("filters by query across title, speakers, track, room, and papers", () => {
    expect(ids({ query: "math" })).toEqual(["w2"]);
    expect(ids({ query: "maya chen" })).toEqual(["keynote", "panel"]);
    // Case- and space-insensitive, like any search box.
    expect(ids({ query: "  COFFEE " })).toEqual(["break"]);
  });

  it("filters by my schedule only when the page supplied one", () => {
    const withSchedule = { ...ctx, mySessionIds: new Set(["w1", "panel"]) };
    expect(ids({ mySchedule: true }, withSchedule)).toEqual(["w1", "panel"]);
    // The public page has no schedule: the flag must not empty the agenda.
    expect(ids({ mySchedule: true })).toEqual(["keynote", "w1", "w2", "break", "panel"]);
  });
});

describe("filterSessions — OR within a group, AND across groups", () => {
  it("ORs inside a multi-select group", () => {
    expect(ids({ formats: ["keynote", "break"] })).toEqual(["keynote", "break"]);
    expect(ids({ roomIds: ["r-12", "r-14"] })).toEqual(["w1", "w2"]);
    // The alternative (AND within a group) could only ever return nothing,
    // since no session is two formats at once.
    expect(ids({ formats: ["keynote", "workshop"] })).toEqual(["keynote", "w1", "w2"]);
  });

  it("ANDs across groups", () => {
    // Workshops OR keynotes, AND in Room 12 → only the Room 12 workshop.
    expect(ids({ formats: ["keynote", "workshop"], roomIds: ["r-12"] })).toEqual(["w1"]);
    // Hall A AND Maya AND day 2 → the panel only, though each alone matches more.
    expect(ids({ roomIds: ["r-hall"], speakerId: "maya", dayKey: "2026-06-09" })).toEqual(["panel"]);
  });

  it("returns nothing when two groups cannot both be satisfied", () => {
    expect(ids({ formats: ["break"], speakerId: "maya" })).toEqual([]);
  });

  it("treats an empty group as no constraint, not as 'match nothing'", () => {
    expect(ids({ formats: [], trackIds: [], roomIds: [] })).toHaveLength(program.length);
  });

  it("combines every group at once", () => {
    expect(
      ids(
        {
          dayKey: "2026-06-08",
          formats: ["workshop"],
          trackIds: ["t-workshops"],
          roomIds: ["r-12", "r-14"],
          speakerId: "jonas",
          hasMaterials: true,
          query: "math",
        },
        ctx,
      ),
    ).toEqual(["w2"]);
  });
});

describe("optionCounts", () => {
  it("counts each option against the other groups, not its own", () => {
    // With "workshop" ticked, the other formats still report what they would
    // show — otherwise every unselected row would read 0 and the numbers would
    // stop being a reason to click.
    const counts = optionCounts(program, { ...EMPTY_AGENDA_FILTERS, formats: ["workshop"] }, ctx, "format");
    expect(counts.get("workshop")).toBe(2);
    expect(counts.get("keynote")).toBe(1);
    expect(counts.get("panel")).toBe(1);
    expect(counts.get("break")).toBe(1);
  });

  it("narrows an option's count by the other groups", () => {
    // Day 1 only: the panel is out, so its track drops to the keynote alone.
    const counts = optionCounts(program, { ...EMPTY_AGENDA_FILTERS, dayKey: "2026-06-08" }, ctx, "track");
    expect(counts.get("t-keynote")).toBe(1);
    expect(counts.get("t-workshops")).toBe(2);
  });

  it("reacts to a filter in a different group", () => {
    const inHallA = optionCounts(program, { ...EMPTY_AGENDA_FILTERS, roomIds: ["r-hall"] }, ctx, "format");
    expect(inHallA.get("keynote")).toBe(1);
    expect(inHallA.get("panel")).toBe(1);
    expect(inHallA.get("break")).toBe(1);
    // No workshop is in Hall A, so the row would show zero.
    expect(inHallA.get("workshop")).toBeUndefined();
  });

  it("counts a session once per speaker, and never counts a missing key", () => {
    const counts = optionCounts(program, EMPTY_AGENDA_FILTERS, ctx, "speaker");
    expect(counts.get("maya")).toBe(2);
    expect(counts.get("jonas")).toBe(2);
    expect(counts.get("elena")).toBe(1);
    // The break has no speaker at all.
    expect(counts.get("")).toBeUndefined();
  });

  it("omits rooms and tracks that nothing matches under the current filters", () => {
    const counts = optionCounts(program, { ...EMPTY_AGENDA_FILTERS, formats: ["break"] }, ctx, "room");
    expect(counts.get("r-hall")).toBe(1);
    expect(counts.get("r-12")).toBeUndefined();
  });
});

describe("isGroupFilterable — sections hide when there is nothing to filter on", () => {
  it("shows a group with two or more options", () => {
    expect(isGroupFilterable(program, "format")).toBe(true);
    expect(isGroupFilterable(program, "room")).toBe(true);
    expect(isGroupFilterable(program, "speaker")).toBe(true);
  });

  it("hides a group no session has a value for", () => {
    const noFormats = program.map((s) => ({ ...s, format: null }));
    expect(isGroupFilterable(noFormats, "format")).toBe(false);
    expect(groupKeyCoverage(noFormats, "format").keys).toEqual([]);
  });

  it("hides a one-room event, where the filter could not remove anything", () => {
    const oneRoom = program.map((s) => ({ ...s, roomId: "r-hall" }));
    expect(isGroupFilterable(oneRoom, "room")).toBe(false);
  });

  it("shows a single option when some sessions lack it", () => {
    // "Workshop" is a real filter on a program where half the rows have no
    // format, and a no-op on one where every row is a workshop.
    const someWorkshops = [
      session({ id: "a", format: "workshop" }),
      session({ id: "b", format: null }),
    ];
    expect(isGroupFilterable(someWorkshops, "format")).toBe(true);
    expect(groupKeyCoverage(someWorkshops, "format")).toEqual({
      keys: ["workshop"],
      anyMissing: true,
    });

    const allWorkshops = [
      session({ id: "a", format: "workshop" }),
      session({ id: "b", format: "workshop" }),
    ];
    expect(isGroupFilterable(allWorkshops, "format")).toBe(false);
  });

  it("hides every group for an empty program", () => {
    for (const group of ["format", "track", "room", "speaker"] as const) {
      expect(isGroupFilterable([], group)).toBe(false);
    }
  });
});

describe("URL state", () => {
  const full: AgendaFilters = {
    dayKey: "2026-06-08",
    formats: ["workshop", "panel"],
    trackIds: ["t-workshops"],
    roomIds: ["r-12", "r-14"],
    speakerId: "maya",
    hasMaterials: true,
    mySchedule: true,
    query: "reading",
  };

  it("round-trips every field: state → query → state", () => {
    expect(filtersFromQuery(filtersToQuery(full))).toEqual(full);
  });

  it("round-trips the empty state to a clean URL and back", () => {
    expect(filtersToQuery(EMPTY_AGENDA_FILTERS)).toEqual({});
    expect(filtersFromQuery({})).toEqual(EMPTY_AGENDA_FILTERS);
  });

  it("writes the documented query shape", () => {
    expect(filtersToQuery(full)).toEqual({
      day: "2026-06-08",
      format: "workshop,panel",
      track: "t-workshops",
      room: "r-12,r-14",
      speaker: "maya",
      materials: "1",
      mine: "1",
      q: "reading",
    });
  });

  it("omits defaults so an unfiltered agenda has no query at all", () => {
    expect(filtersToQuery({ ...EMPTY_AGENDA_FILTERS, hasMaterials: false, query: "   " })).toEqual({});
    expect(filtersToQuery({ ...EMPTY_AGENDA_FILTERS, dayKey: "2026-06-08" })).toEqual({
      day: "2026-06-08",
    });
  });

  it("round-trips through a real query string", () => {
    const search = new URLSearchParams(filtersToQuery(full)).toString();
    const parsed = Object.fromEntries(new URLSearchParams(search));
    expect(filtersFromQuery(parsed)).toEqual(full);
  });

  it("drops a format outside the vocabulary rather than keeping a dead filter", () => {
    // ?format=roundtable is a typo or a stale link; carrying it would put a row
    // in the rail that matches nothing and cannot be labelled.
    expect(filtersFromQuery({ format: "workshop,roundtable,Panel" }).formats).toEqual(["workshop"]);
  });

  it("survives a hand-edited or duplicated query", () => {
    expect(filtersFromQuery({ day: ["2026-06-08", "2026-06-09"] }).dayKey).toBe("2026-06-08");
    expect(filtersFromQuery({ room: "r-12,,r-12, r-14 " }).roomIds).toEqual(["r-12", "r-14"]);
    expect(filtersFromQuery({ materials: "true" }).hasMaterials).toBe(false);
    expect(filtersFromQuery({ materials: "1" }).hasMaterials).toBe(true);
  });

  it("resolves a shared link to the same sessions it was copied from", () => {
    const shared = filtersFromQuery(filtersToQuery({ ...EMPTY_AGENDA_FILTERS, formats: ["workshop"] }));
    expect(filterSessions(program, shared, ctx).map((s) => s.id)).toEqual(["w1", "w2"]);
  });
});

describe("active count and clear all", () => {
  it("excludes the day, so the badge still means 'you have narrowed this'", () => {
    expect(activeFilterCount({ ...EMPTY_AGENDA_FILTERS, dayKey: "2026-06-08" })).toBe(0);
  });

  it("counts each ticked value, not one per group", () => {
    expect(activeFilterCount({ ...EMPTY_AGENDA_FILTERS, formats: ["workshop", "panel"] })).toBe(2);
    expect(
      activeFilterCount({
        ...EMPTY_AGENDA_FILTERS,
        formats: ["workshop"],
        roomIds: ["r-12", "r-14"],
        speakerId: "maya",
        hasMaterials: true,
        mySchedule: true,
        query: "reading",
      }),
    ).toBe(7);
  });

  it("ignores a whitespace-only query", () => {
    expect(activeFilterCount({ ...EMPTY_AGENDA_FILTERS, query: "   " })).toBe(0);
  });

  it("keeps the day when everything else is cleared", () => {
    // The day is a place in the program, not a narrowing of it.
    expect(clearAgendaFilters({ ...EMPTY_AGENDA_FILTERS, dayKey: "2026-06-09", formats: ["panel"] })).toEqual({
      ...EMPTY_AGENDA_FILTERS,
      dayKey: "2026-06-09",
    });
  });
});

describe("helpers", () => {
  it("toggles a value in and out of a group, preserving order", () => {
    expect(toggleFilterValue([], "a")).toEqual(["a"]);
    expect(toggleFilterValue(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleFilterValue(["a", "b"], "a")).toEqual(["b"]);
  });

  it("reads materials from any of the three columns", () => {
    expect(hasSessionMaterials(session({ id: "x" }))).toBe(false);
    expect(hasSessionMaterials(session({ id: "x", fileUrl: "/a.pdf" }))).toBe(true);
    expect(hasSessionMaterials(session({ id: "x", fileLink: "https://a" }))).toBe(true);
    expect(hasSessionMaterials(session({ id: "x", recordingUrl: "https://a" }))).toBe(true);
  });

  it("derives speaker keys from whichever shape the page holds", () => {
    // In-app: nested roster rows.
    expect(sessionSpeakerKeys(session({ id: "x", sessionSpeakers: [{ speaker: { id: "maya", name: "Maya Chen" } }] }))).toEqual(["maya"]);
    // Public page: a flattened roster.
    expect(sessionSpeakerKeys(session({ id: "x", speakerPeople: [{ id: "maya", name: "Maya Chen" }] }))).toEqual(["maya"]);
    // Legacy events have only free text, so names have to serve as keys.
    expect(sessionSpeakerKeys(session({ id: "x", speakers: "Maya Chen, Jonas Okonkwo" }))).toEqual([
      "Maya Chen",
      "Jonas Okonkwo",
    ]);
    expect(sessionSpeakerKeys(session({ id: "x", speakerPeople: [{ name: "No Id" }] }))).toEqual(["No Id"]);
    expect(sessionSpeakerKeys(session({ id: "x" }))).toEqual([]);
  });

  it("states the counts for the print header, naming the total", () => {
    // "7 sessions" alone is indistinguishable from a seven-session event.
    expect(printCountLine(5, 5)).toBe("All 5 sessions");
    expect(printCountLine(1, 1)).toBe("All 1 session");
    expect(printCountLine(3, 24)).toBe("Filtered: 3 of 24 sessions");
    expect(printCountLine(0, 24)).toBe("Filtered: 0 of 24 sessions");
  });
});
