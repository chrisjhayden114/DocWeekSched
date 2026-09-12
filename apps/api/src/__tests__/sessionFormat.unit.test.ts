/**
 * AGENDA-2 — the session format vocabulary and the title cues ingest is
 * allowed to act on.
 *
 * Two rules are load-bearing and both are easy to erode later:
 *   1. the vocabulary is closed, and the DB will not enforce it, so the Zod
 *      schemas are the only thing standing between a typo and a filter option
 *      nothing can label;
 *   2. ingest sets a format only when the title says so outright. The
 *      temptation is always to make the inference cleverer — "Paper session 3B"
 *      is probably a talk — but a wrong guess is worse than a blank, because
 *      the organizer has to notice it before they can correct it.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  SESSION_FORMATS,
  SESSION_FORMAT_LABELS,
  asSessionFormat,
  inferSessionFormat,
} from "@event-app/shared";
import { extractedSessionSchema } from "../lib/ai/ingest/schema";

describe("session format vocabulary", () => {
  it("is exactly the nine agreed formats, in program order", () => {
    expect([...SESSION_FORMATS]).toEqual([
      "keynote",
      "talk",
      "workshop",
      "panel",
      "lightning",
      "poster",
      "break",
      "social",
      "other",
    ]);
  });

  it("labels every format, so no select or filter row can render a bare key", () => {
    for (const format of SESSION_FORMATS) {
      expect(SESSION_FORMAT_LABELS[format]).toBeTruthy();
      expect(SESSION_FORMAT_LABELS[format]).not.toBe(format);
    }
    expect(Object.keys(SESSION_FORMAT_LABELS).sort()).toEqual([...SESSION_FORMATS].sort());
  });

  it("rejects anything outside the vocabulary, including near-misses and casing", () => {
    const schema = z.enum(SESSION_FORMATS).nullable().optional();
    for (const format of SESSION_FORMATS) {
      expect(schema.safeParse(format).success).toBe(true);
    }
    expect(schema.safeParse(null).success).toBe(true);
    expect(schema.safeParse(undefined).success).toBe(true);
    for (const bad of ["Keynote", "KEYNOTE", "roundtable", "lightning talk", "", " keynote", 1, {}]) {
      expect(schema.safeParse(bad).success, `${JSON.stringify(bad)} must be rejected`).toBe(false);
    }
  });

  it("narrows unknown stored values to null rather than promoting them to `other`", () => {
    // "other" is a choice an organizer makes. Quietly mapping a typo onto it
    // would hide the typo behind a plausible-looking answer.
    expect(asSessionFormat("workshop")).toBe("workshop");
    expect(asSessionFormat("roundtable")).toBeNull();
    expect(asSessionFormat(null)).toBeNull();
    expect(asSessionFormat(undefined)).toBeNull();
    expect(asSessionFormat(7)).toBeNull();
  });
});

describe("inferSessionFormat", () => {
  it("fires on each listed cue", () => {
    const cases: Array<[string, string]> = [
      ["Opening keynote: Designing calm learning days", "keynote"],
      ["Closing Keynote", "keynote"],
      ["Workshop block A: Reading conferences", "workshop"],
      ["Two workshops back to back", "workshop"],
      ["Panel: what we changed this year", "panel"],
      ["Panels and posters", "panel"],
      ["Lightning talks", "lightning"],
      ["Poster session", "poster"],
      ["Posters and coffee", "poster"],
      ["Morning break", "break"],
      ["Breaks and stretching", "break"],
      ["Lunch", "break"],
      ["Coffee and pastries", "break"],
      ["Registration", "break"],
      ["Evening reception", "social"],
      ["Social hour", "social"],
      ["Networking in the atrium", "social"],
    ];
    for (const [title, expected] of cases) {
      expect(inferSessionFormat(title), title).toBe(expected);
    }
  });

  it("stays null for every title that does not state a format", () => {
    // The common case in a real program, and the reason the filter section
    // hides itself when an event has no formats at all.
    for (const title of [
      "Paper session 3B",
      "What worked this year",
      "Practice showcase",
      "Closing roundtable: What we will change next term",
      "Reading conferences in Year 4",
      "Assessment and reporting",
      "",
    ]) {
      expect(inferSessionFormat(title), title).toBeNull();
    }
    expect(inferSessionFormat(null)).toBeNull();
    expect(inferSessionFormat(undefined)).toBeNull();
  });

  it("does not mistake a breakout for a coffee break", () => {
    // \bbreak\b, not /break/. "Breakout" is the single most common word in a
    // conference program that contains a cue as a prefix.
    expect(inferSessionFormat("Breakout session 2")).toBeNull();
    expect(inferSessionFormat("Breakouts")).toBeNull();
  });

  it("resolves a title with two cues to the first in vocabulary order", () => {
    // Stable rather than dependent on which regex happens to run first.
    expect(inferSessionFormat("Keynote panel")).toBe("keynote");
    expect(inferSessionFormat("Workshop panel")).toBe("workshop");
    expect(inferSessionFormat("Lunch reception")).toBe("break");
  });
});

describe("extractedSessionSchema format", () => {
  const base = { title: "Opening keynote", date: "2026-06-08", startTime: "09:00" };

  it("accepts a format the model volunteered", () => {
    const parsed = extractedSessionSchema.parse({ ...base, format: "keynote" });
    expect(parsed.format).toBe("keynote");
  });

  it("drops an invented format instead of failing the whole extraction", () => {
    // An organizer is watching a progress bar. One hallucinated enum value
    // must not throw away a correctly extracted 60-session program.
    const parsed = extractedSessionSchema.parse({ ...base, format: "roundtable" });
    expect(parsed.format).toBeUndefined();
    expect(parsed.title).toBe("Opening keynote");
  });

  it("leaves format absent when the source never mentioned one", () => {
    expect(extractedSessionSchema.parse(base).format).toBeUndefined();
  });
});
