import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyImportScope,
  deleteRowsBlastCopy,
  groupCreateRows,
  removalsOf,
  rowsToApiChangeset,
  sessionDeleteBlastCopy,
  toggleRemoval,
} from "../lib/ingestReview";

/**
 * E13.3: the review screen offers explicit, unchecked-by-default removal
 * proposals for children a re-import does not mention. These helpers carry
 * the organiser's ticks from the checkboxes to the confirm payload.
 */
describe("ingest review helpers (E13.3)", () => {
  const rows = [
    {
      kind: "update",
      rowIndex: 0,
      sessionId: "s1",
      itemRemovals: [{ itemId: "i1", title: "Hand Paper", accepted: false }],
      speakerRemovals: [
        { speakerId: "sp1", name: "Hand Speaker", accepted: false },
        { speakerId: "sp2", name: "Second Speaker", accepted: false },
      ],
    },
    { kind: "create", rowIndex: 1, title: "New Session" },
  ];

  it("toggleRemoval flips only the targeted entry and leaves other rows alone", () => {
    const next = toggleRemoval(rows, 0, "item", "i1", true);
    expect(removalsOf(next[0], "item")[0].accepted).toBe(true);
    expect(removalsOf(next[0], "speaker").every((r) => r.accepted === false)).toBe(true);
    expect(next[1]).toBe(rows[1]);

    const withSpeaker = toggleRemoval(next, 0, "speaker", "sp2", true);
    expect(removalsOf(withSpeaker[0], "speaker").map((r) => r.accepted)).toEqual([false, true]);

    const backOff = toggleRemoval(withSpeaker, 0, "item", "i1", false);
    expect(removalsOf(backOff[0], "item")[0].accepted).toBe(false);
  });

  it("removals default to no-op arrays for rows without them", () => {
    expect(removalsOf(rows[1], "item")).toEqual([]);
    expect(removalsOf(rows[1], "speaker")).toEqual([]);
  });

  it("rowsToApiChangeset carries edited removal ticks over the original changeset", () => {
    const edited = toggleRemoval(rows, 0, "speaker", "sp1", true);
    const payload = rowsToApiChangeset(edited, [
      {
        rowIndex: 0,
        kind: "update",
        sessionId: "s1",
        existingTitle: "Original Title",
        speakerRemovals: [
          { speakerId: "sp1", name: "Hand Speaker", accepted: false },
          { speakerId: "sp2", name: "Second Speaker", accepted: false },
        ],
        itemRemovals: [{ itemId: "i1", title: "Hand Paper", accepted: false }],
      },
    ]);
    const removals = payload[0].speakerRemovals as { speakerId: string; accepted: boolean }[];
    expect(removals.find((r) => r.speakerId === "sp1")?.accepted).toBe(true);
    expect(removals.find((r) => r.speakerId === "sp2")?.accepted).toBe(false);
    // Fields the UI does not track survive the round-trip.
    expect(payload[0].existingTitle).toBe("Original Title");
  });
});

/**
 * H2 (D2): the review screen groups create rows by day + start time so a
 * 60-row import reads as a handful of verifiable timeslots.
 */
describe("groupCreateRows (H2/D2)", () => {
  const row = (
    rowIndex: number,
    session?: { date?: string; startTime?: string; room?: string },
    day?: string,
  ) => ({ kind: "create", rowIndex, day, session });

  it("groups by day + startTime and counts distinct non-empty rooms", () => {
    const groups = groupCreateRows([
      row(0, { date: "2026-09-01", startTime: "09:00", room: "Room A" }),
      row(1, { date: "2026-09-01", startTime: "09:00", room: "Room B" }),
      row(2, { date: "2026-09-01", startTime: "09:00", room: "Room A" }),
      row(3, { date: "2026-09-01", startTime: "09:00", room: "  " }),
      row(4, { date: "2026-09-01", startTime: "11:00" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].day).toBe("2026-09-01");
    expect(groups[0].startTime).toBe("09:00");
    expect(groups[0].rows.map((r) => r.rowIndex)).toEqual([0, 1, 2, 3]);
    expect(groups[0].roomCount).toBe(2);
    expect(groups[1].roomCount).toBe(0);
  });

  it("prefers row.day over session.date and orders by day then startTime", () => {
    const groups = groupCreateRows([
      row(0, { date: "2026-09-02", startTime: "14:00" }),
      row(1, { date: "2026-09-01", startTime: "13:00" }),
      row(2, { startTime: "09:00" }, "2026-09-02"),
      row(3, { date: "2026-09-01", startTime: "09:00" }),
    ]);
    expect(groups.map((g) => [g.day, g.startTime])).toEqual([
      ["2026-09-01", "09:00"],
      ["2026-09-01", "13:00"],
      ["2026-09-02", "09:00"],
      ["2026-09-02", "14:00"],
    ]);
  });

  it("sends rows lacking both day and startTime to a trailing 'other' group", () => {
    const groups = groupCreateRows([
      row(0, { room: "Hall" }),
      row(1, { date: "2026-09-01", startTime: "09:00" }),
      row(2, undefined),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].startTime).toBe("09:00");
    expect(groups[1].key).toBe("other");
    expect(groups[1].day).toBeNull();
    expect(groups[1].startTime).toBeNull();
    expect(groups[1].rows.map((r) => r.rowIndex)).toEqual([0, 2]);
  });

  it("passes a single slot through as one group", () => {
    const rows = [
      row(0, { date: "2026-09-01", startTime: "09:00" }),
      row(1, { date: "2026-09-01", startTime: "09:00" }),
    ];
    const groups = groupCreateRows(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(2);
  });
});

/**
 * H3 (D1): re-import delete proposals are discarded when the organiser says
 * the file was only part of the program (the default).
 */
describe("applyImportScope (H3/D1)", () => {
  const mixed = [
    { kind: "create", rowIndex: 0 },
    { kind: "update", rowIndex: 1 },
    { kind: "delete", rowIndex: 2 },
    { kind: "error", rowIndex: 3 },
    { kind: "delete", rowIndex: 4 },
  ];

  it("part removes delete rows only", () => {
    expect(applyImportScope(mixed, "part").map((r) => r.kind)).toEqual([
      "create",
      "update",
      "error",
    ]);
  });

  it("full is identity", () => {
    expect(applyImportScope(mixed, "full")).toEqual(mixed);
  });

  it("empty input is safe", () => {
    expect(applyImportScope([], "part")).toEqual([]);
    expect(applyImportScope([], "full")).toEqual([]);
  });
});

describe("W-6 — ingest delete confirm includes attendee counts", () => {
  it("the review UI renders the blast-radius copy", () => {
    const review = readFileSync(join(__dirname, "..", "components", "ReviewChangeset.tsx"), "utf8");
    const ingest = readFileSync(
      join(__dirname, "..", "pages", "organizer", "events", "[eventId]", "ingest.tsx"),
      "utf8",
    );
    expect(review).toContain("sessionDeleteBlastCopy");
    expect(review).toContain("deleteRowsBlastCopy");
    expect(ingest).toContain("joinedCount:");
    expect(ingest).toContain("bookmarkCount:");
  });

  it("names joined and bookmarked counts", () => {
    expect(sessionDeleteBlastCopy(3, 2)).toBe(
      "3 joined, 2 bookmarked — their schedules lose this session.",
    );
    expect(sessionDeleteBlastCopy(1, 0)).toMatch(/1 joined/);
    expect(sessionDeleteBlastCopy(0, 0)).toMatch(/No attendees have joined or bookmarked/);
  });

  it("the confirm line totals accepted delete rows", () => {
    const copy = deleteRowsBlastCopy([
      { accepted: true, joinedCount: 3, bookmarkCount: 1 },
      { accepted: false, joinedCount: 9, bookmarkCount: 9 },
      { accepted: true, joinedCount: 0, bookmarkCount: 2 },
    ]);
    expect(copy).toContain("Deleting 2 sessions.");
    expect(copy).toContain("3 joined");
    expect(copy).toContain("3 bookmarked");
  });
});
