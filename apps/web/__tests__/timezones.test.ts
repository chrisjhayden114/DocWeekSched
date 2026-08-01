import { describe, expect, it } from "vitest";
import {
  FALLBACK_TIMEZONES,
  filterTimezones,
  getTimezoneOptions,
  isValidTimezone,
  timezoneOffsetLabel,
} from "../lib/timezones";

describe("getTimezoneOptions", () => {
  it("returns a non-empty list containing common zones", () => {
    const zones = getTimezoneOptions();
    expect(zones.length).toBeGreaterThan(10);
    expect(zones).toContain("UTC");
    expect(zones).toContain("America/New_York");
    expect(zones).toContain("America/Los_Angeles");
  });
});

describe("FALLBACK_TIMEZONES", () => {
  it("only contains zones the runtime accepts", () => {
    for (const tz of FALLBACK_TIMEZONES) {
      expect(isValidTimezone(tz), `invalid zone in fallback list: ${tz}`).toBe(true);
    }
  });
});

describe("filterTimezones", () => {
  const zones = ["America/Los_Angeles", "America/New_York", "Europe/London", "UTC"];

  it("returns everything for an empty query", () => {
    expect(filterTimezones(zones, "")).toEqual(zones);
    expect(filterTimezones(zones, "   ")).toEqual(zones);
  });

  it("matches case-insensitive substrings", () => {
    expect(filterTimezones(zones, "london")).toEqual(["Europe/London"]);
    expect(filterTimezones(zones, "AMERICA")).toEqual(["America/Los_Angeles", "America/New_York"]);
  });

  it("matches spaces against underscores", () => {
    expect(filterTimezones(zones, "los angeles")).toEqual(["America/Los_Angeles"]);
    expect(filterTimezones(zones, "new york")).toEqual(["America/New_York"]);
  });

  it("returns empty for no match", () => {
    expect(filterTimezones(zones, "gotham")).toEqual([]);
  });
});

describe("timezoneOffsetLabel", () => {
  it("formats a fixed-offset zone", () => {
    // Kolkata never observes DST: always UTC+05:30.
    expect(timezoneOffsetLabel("Asia/Kolkata", new Date("2026-01-15T12:00:00Z"))).toBe("UTC+05:30");
  });

  it("labels UTC explicitly", () => {
    expect(timezoneOffsetLabel("UTC")).toBe("UTC+00:00");
  });

  it("returns empty string for an invalid zone", () => {
    expect(timezoneOffsetLabel("Not/AZone")).toBe("");
  });
});

describe("isValidTimezone", () => {
  it("accepts real zones and rejects typos", () => {
    expect(isValidTimezone("America/Chicago")).toBe(true);
    expect(isValidTimezone("America/Chicagoo")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
  });
});
