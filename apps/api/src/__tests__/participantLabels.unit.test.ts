import { describe, expect, it } from "vitest";
import {
  normalizeMembershipLabel,
  normalizeParticipantLabels,
  parseParticipantLabels,
  PARTICIPANT_LABELS_MAX,
  PARTICIPANT_LABEL_MAX_CHARS,
} from "../lib/participantLabels";

describe("normalizeParticipantLabels — count / length / uniqueness", () => {
  it("trims, drops blanks, and keeps order", () => {
    const result = normalizeParticipantLabels(["  Class of 2028 ", "", "Science Dept"]);
    expect(result).toEqual({ ok: true, labels: ["Class of 2028", "Science Dept"] });
  });

  it("accepts an empty list (clear)", () => {
    expect(normalizeParticipantLabels([])).toEqual({ ok: true, labels: [] });
    expect(normalizeParticipantLabels(["  ", ""])).toEqual({ ok: true, labels: [] });
  });

  it("rejects a non-array", () => {
    expect(normalizeParticipantLabels("Class of 2028")).toEqual({
      ok: false,
      error: "participantLabels must be an array of strings",
    });
  });

  it("rejects a non-string entry", () => {
    expect(normalizeParticipantLabels(["Ok", 12])).toEqual({
      ok: false,
      error: "Each label must be a string",
    });
  });

  it("rejects a label longer than 40 characters", () => {
    const tooLong = "x".repeat(PARTICIPANT_LABEL_MAX_CHARS + 1);
    const result = normalizeParticipantLabels([tooLong]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/1–40 characters/);
  });

  it("accepts a 40-character label", () => {
    const max = "x".repeat(PARTICIPANT_LABEL_MAX_CHARS);
    expect(normalizeParticipantLabels([max])).toEqual({ ok: true, labels: [max] });
  });

  it("rejects more than 20 labels", () => {
    const many = Array.from({ length: PARTICIPANT_LABELS_MAX + 1 }, (_, i) => `Label ${i + 1}`);
    const result = normalizeParticipantLabels(many);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/At most 20/);
  });

  it("accepts exactly 20 labels", () => {
    const many = Array.from({ length: PARTICIPANT_LABELS_MAX }, (_, i) => `Label ${i + 1}`);
    expect(normalizeParticipantLabels(many)).toEqual({ ok: true, labels: many });
  });

  it("rejects duplicates after trim, case-insensitively", () => {
    expect(normalizeParticipantLabels(["Science", "science"])).toEqual({
      ok: false,
      error: "Labels must be unique",
    });
    expect(normalizeParticipantLabels(["Cohort A", " Cohort A "])).toEqual({
      ok: false,
      error: "Labels must be unique",
    });
  });
});

describe("normalizeMembershipLabel — must belong to the event list", () => {
  const eventLabels = ["Class of 2028", "Science Dept"];

  it("accepts an exact list match", () => {
    expect(normalizeMembershipLabel("Class of 2028", eventLabels)).toEqual({
      ok: true,
      label: "Class of 2028",
    });
  });

  it("trims before matching", () => {
    expect(normalizeMembershipLabel("  Science Dept  ", eventLabels)).toEqual({
      ok: true,
      label: "Science Dept",
    });
  });

  it("treats null / blank as clear", () => {
    expect(normalizeMembershipLabel(null, eventLabels)).toEqual({ ok: true, label: null });
    expect(normalizeMembershipLabel("", eventLabels)).toEqual({ ok: true, label: null });
    expect(normalizeMembershipLabel("   ", eventLabels)).toEqual({ ok: true, label: null });
  });

  it("rejects a label that is not on this event", () => {
    expect(normalizeMembershipLabel("Engineering", eventLabels)).toEqual({
      ok: false,
      error: "Label must be one of this event's participant labels",
    });
  });

  it("rejects a case-shifted match — stored strings are exact", () => {
    expect(normalizeMembershipLabel("class of 2028", eventLabels).ok).toBe(false);
  });

  it("rejects any non-null label when the event defines none", () => {
    expect(normalizeMembershipLabel("Class of 2028", [])).toEqual({
      ok: false,
      error: "Label must be one of this event's participant labels",
    });
    expect(normalizeMembershipLabel(null, [])).toEqual({ ok: true, label: null });
  });
});

describe("parseParticipantLabels — forgiving read", () => {
  it("returns [] for null, invalid JSON, or a non-array", () => {
    expect(parseParticipantLabels(null)).toEqual([]);
    expect(parseParticipantLabels("not-json")).toEqual([]);
    expect(parseParticipantLabels("{}")).toEqual([]);
  });

  it("parses a stored list and drops junk", () => {
    expect(parseParticipantLabels(JSON.stringify(["  A ", "", "B"]))).toEqual(["A", "B"]);
  });
});
