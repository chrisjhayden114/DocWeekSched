import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyImportScope,
  changesOf,
  decisionOf,
  decisionSelection,
  deleteRowsBlastCopy,
  groupCreateRows,
  moveRowsBlastCopy,
  removalsOf,
  resolveMatchDecision,
  rowsToApiChangeset,
  sessionDeleteBlastCopy,
  sessionMoveBlastCopy,
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

/**
 * W-7: a revised upload updates the session it describes. Where the match is
 * ambiguous the matcher refuses to guess and the row stays an ADD carrying
 * its candidates — these helpers carry the organiser's choice to confirm.
 */
describe("W-7 — ambiguous match decisions", () => {
  const roomChange = { field: "room", label: "Room", from: "Room A", to: "Room B" };
  const dayChange = { field: "day", label: "Day", from: "2027-06-11", to: "2027-06-12" };

  const rows = () => [
    {
      kind: "create",
      rowIndex: 0,
      title: "Workshop",
      day: "2027-06-12",
      accepted: true,
      session: { title: "Workshop", date: "2027-06-12", startTime: "09:00", room: "Room B" },
      decision: {
        reason: "multiple-existing",
        message: "Matches 2 existing sessions equally well — pick one, or add it as new.",
        candidates: [
          {
            sessionId: "sess-a",
            existingTitle: "Workshop",
            existingDay: "2027-06-12",
            existingTime: "09:00–10:00",
            existingRoom: "Room A",
            tier: "exact",
            similarity: 1,
            message: "moved room",
            movesTime: false,
            changes: [roomChange],
            joinedCount: 4,
            bookmarkCount: 1,
          },
          {
            sessionId: "sess-b",
            existingTitle: "Workshop",
            existingDay: "2027-06-11",
            existingTime: "09:00–10:00",
            existingRoom: "Room B",
            tier: "moved",
            similarity: 1,
            message: "moved day",
            movesTime: true,
            changes: [dayChange],
            joinedCount: 6,
            bookmarkCount: 2,
            speakerRemovals: [{ speakerId: "sp1", name: "Hand Speaker", accepted: false }],
          },
        ],
      },
    },
    { kind: "create", rowIndex: 1, title: "Unrelated New Session", accepted: true },
  ];

  it("an unresolved row is an add carrying both candidates", () => {
    const [row] = rows();
    expect(row.kind).toBe("create");
    expect(row.accepted).toBe(true);
    expect(decisionOf(row)?.candidates).toHaveLength(2);
    expect(decisionSelection(row)).toBeNull();
  });

  it("choosing a candidate turns the row into an update carrying that candidate's diff", () => {
    const next = resolveMatchDecision(rows(), 0, "sess-b");
    const row = next[0];
    expect(row.kind).toBe("update");
    expect(row.sessionId).toBe("sess-b");
    expect(row.existingTitle).toBe("Workshop");
    expect(row.message).toBe("moved day");
    expect(row.similarity).toBe(1);
    expect(changesOf(row)).toEqual([dayChange]);
    expect(row.movesTime).toBe(true);
    expect(row.joinedCount).toBe(6);
    expect(row.bookmarkCount).toBe(2);
    // The candidate's child-removal proposals come with it, still unticked.
    expect(removalsOf(row, "speaker")).toEqual([
      { speakerId: "sp1", name: "Hand Speaker", accepted: false },
    ]);
    // The decision stays on the row so the choice can be revisited.
    expect(decisionSelection(row)).toBe("sess-b");
    expect(decisionOf(row)?.candidates).toHaveLength(2);
    // Untouched rows are untouched.
    expect(next[1]).toEqual(rows()[1]);
  });

  it("switching candidates replaces the diff rather than merging it", () => {
    const next = resolveMatchDecision(resolveMatchDecision(rows(), 0, "sess-b"), 0, "sess-a");
    expect(next[0].sessionId).toBe("sess-a");
    expect(changesOf(next[0])).toEqual([roomChange]);
    expect(next[0].movesTime).toBe(false);
    expect(next[0].joinedCount).toBe(4);
    expect(removalsOf(next[0], "speaker")).toEqual([]);
  });

  it("going back to add drops every update-only field", () => {
    const next = resolveMatchDecision(resolveMatchDecision(rows(), 0, "sess-a"), 0, null);
    const row = next[0];
    expect(row.kind).toBe("create");
    expect(row).not.toHaveProperty("sessionId");
    expect(row).not.toHaveProperty("existingTitle");
    expect(row).not.toHaveProperty("changes");
    expect(row).not.toHaveProperty("joinedCount");
    expect(decisionSelection(row)).toBeNull();
    expect(decisionOf(row)?.candidates).toHaveLength(2);
  });

  it("rows without a decision, and unknown candidates, are left alone", () => {
    expect(resolveMatchDecision(rows(), 1, "sess-a")[1]).toEqual(rows()[1]);
    expect(resolveMatchDecision(rows(), 0, "sess-nope")[0]).toEqual(rows()[0]);
    expect(decisionOf({ kind: "create", rowIndex: 0 })).toBeUndefined();
    expect(decisionOf({ kind: "create", rowIndex: 0, decision: { candidates: [] } })).toBeUndefined();
  });

  it("the confirm payload sends the resolved match, and the add when reverted", () => {
    const original = rows();
    const resolved = rowsToApiChangeset(resolveMatchDecision(rows(), 0, "sess-b"), original);
    expect(resolved[0].kind).toBe("update");
    expect(resolved[0].sessionId).toBe("sess-b");
    expect(resolved[0].existingTitle).toBe("Workshop");
    expect(resolved[0].message).toBe("moved day");
    // The extracted session still rides along — it is what confirm writes.
    expect((resolved[0].session as { room?: string }).room).toBe("Room B");

    const reverted = rowsToApiChangeset(
      resolveMatchDecision(resolveMatchDecision(rows(), 0, "sess-b"), 0, null),
      original,
    );
    expect(reverted[0].kind).toBe("create");
    expect(reverted[0].sessionId).toBeUndefined();
    expect(reverted[0].existingTitle).toBeUndefined();
  });
});

describe("W-7 — moves name the attendees they reschedule", () => {
  it("names joined and bookmarked counts for one moved session", () => {
    expect(sessionMoveBlastCopy(12, 3)).toBe("12 joined, 3 bookmarked — their schedules move with it.");
    expect(sessionMoveBlastCopy(1, 0)).toMatch(/1 joined/);
    expect(sessionMoveBlastCopy(0, 0)).toMatch(/No attendees have joined or bookmarked/);
  });

  it("totals only accepted rows that actually move times", () => {
    const copy = moveRowsBlastCopy([
      { accepted: true, movesTime: true, joinedCount: 5, bookmarkCount: 1 },
      { accepted: true, movesTime: false, joinedCount: 99, bookmarkCount: 99 },
      { accepted: false, movesTime: true, joinedCount: 99, bookmarkCount: 99 },
      { accepted: true, movesTime: true, joinedCount: 2, bookmarkCount: 0 },
    ]);
    expect(copy).toContain("Moving 2 sessions.");
    expect(copy).toContain("7 joined");
    expect(copy).toContain("1 bookmarked");
    expect(moveRowsBlastCopy([{ accepted: true, movesTime: false, joinedCount: 4 }])).toBeNull();
  });

  it("the review UI renders the diff, the decision picker and the move copy", () => {
    const review = readFileSync(join(__dirname, "..", "components", "ReviewChangeset.tsx"), "utf8");
    const ingest = readFileSync(
      join(__dirname, "..", "pages", "organizer", "events", "[eventId]", "ingest.tsx"),
      "utf8",
    );
    expect(review).toContain("FieldDiffList");
    expect(review).toContain("Needs your decision");
    expect(review).toContain("Add as a new session (default)");
    expect(review).toContain("sessionMoveBlastCopy");
    expect(review).toContain("moveRowsBlastCopy");
    // Nothing applies without confirm: the picker only edits review rows.
    expect(ingest).toContain("resolveMatchDecision");
    expect(ingest).toContain("onDecisionChange");
  });
});
