import { describe, expect, it } from "vitest";
import { removalsOf, rowsToApiChangeset, toggleRemoval } from "../lib/ingestReview";

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
