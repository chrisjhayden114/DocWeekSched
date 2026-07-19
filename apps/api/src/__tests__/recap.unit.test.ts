import { describe, expect, it } from "vitest";
import {
  assertNoLiteralNumbersOutsidePlaceholders,
  getMetricPathValue,
  substituteMetricPlaceholders,
} from "../lib/ai/recap/placeholders";
import { compareTopSessions } from "../lib/ai/recap/metrics";
import { redactPii, quoteIdForFeedback } from "../lib/ai/recap/quotes";
import {
  resolveFixNextYear,
  resolveSynthesisThemes,
  stableFixSlug,
} from "../lib/ai/recap/synthesis";
import { mergeFixNextYearIntoChecklist } from "../lib/ai/recap/series";
import { RecapSectionError, type RecapMetricsSnapshot, type FeedbackQuote } from "../lib/ai/recap/types";

const sampleSnapshot: RecapMetricsSnapshot = {
  eventId: "evt_1",
  computedAt: "2026-07-18T00:00:00.000Z",
  headline: {
    registrants: 10,
    checkIns: 7,
    checkInRate: 0.7,
    adoptionCount: 8,
    adoptionRate: 0.8,
  },
  engagement: {
    qaThreads: 3,
    qaUpvotes: 5,
    pollVotes: 12,
    communityThreads: 2,
    communityReplies: 4,
    engagementPoints: 100,
  },
  sessions: [
    {
      sessionId: "sess_a",
      title: "Alpha",
      startsAt: "2026-07-01T10:00:00.000Z",
      joinedByMode: { IN_PERSON: 4, VIRTUAL: 1 },
      joinedTotal: 5,
      checkedInAttributedByMode: { IN_PERSON: 3, VIRTUAL: 1 },
      checkedInAttributedTotal: 4,
      noShowTotal: 1,
      noShowByMode: { IN_PERSON: 1 },
      likes: 2,
      qaThreads: 1,
      pollVotes: 3,
      feedbackCount: 2,
      avgFeedback: 4.5,
    },
  ],
  topSessions: [
    {
      sessionId: "sess_a",
      title: "Alpha",
      joinedTotal: 5,
      feedbackCount: 2,
      avgFeedback: 4.5,
      likes: 2,
      qaThreads: 1,
    },
  ],
  labels: {
    checkedInAttributedByMode:
      "Event check-in attributed via session join mode (not a per-session door scan)",
  },
};

describe("recap placeholders", () => {
  it("substitutes verified metric paths", () => {
    const out = substituteMetricPlaceholders(
      "Regs {{headline.registrants}} / check-ins {{headline.checkIns}} / IP {{sessions.sess_a.joinedByMode.IN_PERSON}}",
      sampleSnapshot,
      ["headline.registrants", "headline.checkIns", "sessions.sess_a.joinedByMode.IN_PERSON"],
    );
    expect(out).toBe("Regs 10 / check-ins 7 / IP 4");
  });

  it("rejects unknown metric paths", () => {
    expect(() =>
      substituteMetricPlaceholders("Bad {{headline.invented}}", sampleSnapshot),
    ).toThrow(RecapSectionError);
    try {
      substituteMetricPlaceholders("Bad {{headline.invented}}", sampleSnapshot);
    } catch (e) {
      expect((e as RecapSectionError).code).toBe("UNKNOWN_METRIC_PATH");
    }
  });

  it("rejects literal numbers outside placeholders (invented digits)", () => {
    expect(() => assertNoLiteralNumbersOutsidePlaceholders("We had 999 attendees")).toThrow(
      RecapSectionError,
    );
    expect(() => assertNoLiteralNumbersOutsidePlaceholders("We had {{headline.registrants}} attendees")).not.toThrow();
  });

  it("getMetricPathValue reads nested session modes", () => {
    expect(getMetricPathValue(sampleSnapshot, "sessions.sess_a.checkedInAttributedByMode.IN_PERSON")).toBe(3);
    expect(getMetricPathValue(sampleSnapshot, "labels.checkedInAttributedByMode")).toMatch(/not a per-session door scan/);
  });
});

describe("recap feedback synthesis resolve", () => {
  const bank: FeedbackQuote[] = [
    {
      quoteId: "sf_1",
      sessionId: "sess_a",
      text: "Great rooms",
      source: "session_feedback",
      feedbackId: "1",
    },
    {
      quoteId: "sf_2",
      sessionId: "sess_a",
      text: "Need better wifi",
      source: "session_feedback",
      feedbackId: "2",
    },
  ];

  it("maps quotes from bank and computes commentCount in code", () => {
    const themes = resolveSynthesisThemes(
      [{ label: "Logistics", quoteIds: ["sf_1", "sf_2", "sf_invented"] }],
      bank,
    );
    expect(themes).toHaveLength(1);
    expect(themes[0]!.commentCount).toBe(2);
    expect(themes[0]!.quotes.map((q) => q.text)).toEqual(["Great rooms", "Need better wifi"]);
    expect(themes[0]!.quoteIds).not.toContain("sf_invented");
  });

  it("drops invented quote ids so invented text never reaches storage", () => {
    const themes = resolveSynthesisThemes(
      [{ label: "Fake", quoteIds: ["sf_nope"] }],
      bank,
    );
    expect(themes[0]!.quotes).toEqual([]);
    expect(themes[0]!.commentCount).toBe(0);
  });

  it("builds stable fix-next-year keys", () => {
    const items = resolveFixNextYear([{ label: "Improve Wi-Fi!" }]);
    expect(items[0]!.key).toBe(`recap_fix:${stableFixSlug("Improve Wi-Fi!")}`);
  });
});

describe("recap PII redact + quote ids", () => {
  it("redacts emails phones and known names", () => {
    expect(redactPii("Call Ada Lovelace at ada@example.com or +1 555-123-4567", ["Ada Lovelace"])).toBe(
      "Call [name] at [email] or [phone]",
    );
  });

  it("stable quote ids from feedback id", () => {
    expect(quoteIdForFeedback("abc")).toBe("sf_abc");
  });
});

describe("recap top-session sort", () => {
  it("uses fixed sort keys", () => {
    const a = {
      sessionId: "a",
      joinedTotal: 5,
      feedbackCount: 1,
      avgFeedback: 4,
      likes: 1,
      qaThreads: 0,
    };
    const b = {
      sessionId: "b",
      joinedTotal: 5,
      feedbackCount: 2,
      avgFeedback: 3,
      likes: 0,
      qaThreads: 0,
    };
    expect(compareTopSessions(a, b)).toBeGreaterThan(0); // b first
  });
});

describe("series checklist merge", () => {
  it("is idempotent by key and updates label on regen", () => {
    const first = mergeFixNextYearIntoChecklist(
      [{ key: "review_tracks", label: "Review tracks", done: true }],
      [{ key: "recap_fix:wifi", label: "Fix wifi" }],
      { sourceEventId: "e1", sourceRecapId: "r1" },
    );
    expect(first).toHaveLength(2);
    const second = mergeFixNextYearIntoChecklist(
      first,
      [{ key: "recap_fix:wifi", label: "Fix wifi (updated)" }],
      { sourceEventId: "e1", sourceRecapId: "r2" },
    );
    expect(second.filter((c) => c.key === "recap_fix:wifi")).toHaveLength(1);
    expect(second.find((c) => c.key === "recap_fix:wifi")!.label).toBe("Fix wifi (updated)");
    expect(second.find((c) => c.key === "review_tracks")!.done).toBe(true);
  });
});
