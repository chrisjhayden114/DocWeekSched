import { describe, expect, it } from "vitest";
import { formatEventDateRange } from "../lib/dateFormat";

/**
 * F2 — the Overview state line's compact date range
 * ("Draft · Jun 8–10 · 3 steps from publishing"), rendered in the
 * event's timezone.
 */
describe("F2 — formatEventDateRange", () => {
  it("same month: Jun 8–10", () => {
    expect(
      formatEventDateRange("2026-06-08T12:00:00Z", "2026-06-10T12:00:00Z", "UTC"),
    ).toBe("Jun 8–10");
  });

  it("single day: Jun 8", () => {
    expect(
      formatEventDateRange("2026-06-08T09:00:00Z", "2026-06-08T17:00:00Z", "UTC"),
    ).toBe("Jun 8");
  });

  it("crosses a month: Jun 28 – Jul 2", () => {
    expect(
      formatEventDateRange("2026-06-28T12:00:00Z", "2026-07-02T12:00:00Z", "UTC"),
    ).toBe("Jun 28 – Jul 2");
  });

  it("crosses a year: both dates carry the year", () => {
    expect(
      formatEventDateRange("2026-12-30T12:00:00Z", "2027-01-02T12:00:00Z", "UTC"),
    ).toBe("Dec 30, 2026 – Jan 2, 2027");
  });

  it("respects the event timezone, not UTC", () => {
    // 2026-06-09T02:00Z is still Jun 8 in New York (UTC-4 in June).
    expect(
      formatEventDateRange("2026-06-09T02:00:00Z", "2026-06-11T02:00:00Z", "America/New_York"),
    ).toBe("Jun 8–10");
  });

  it("invalid input yields an empty string", () => {
    expect(formatEventDateRange("not-a-date", "2026-06-10T12:00:00Z", "UTC")).toBe("");
  });
});
