import { describe, expect, it } from "vitest";
import {
  isOutsideEventDates,
  toLocalInputValueInTimeZone,
  zonedDateTimeLocalToIso,
  zonedDayKey,
} from "../lib/eventTimezone";

describe("toLocalInputValueInTimeZone", () => {
  it("renders an instant as the event zone's wall clock (DST summer)", () => {
    // 16:00 UTC on Jul 20 = 9:00 AM in Los Angeles (PDT, UTC-7).
    expect(toLocalInputValueInTimeZone("2026-07-20T16:00:00.000Z", "America/Los_Angeles")).toBe(
      "2026-07-20T09:00",
    );
  });

  it("renders winter offsets correctly", () => {
    // 17:00 UTC on Jan 15 = 9:00 AM in Los Angeles (PST, UTC-8).
    expect(toLocalInputValueInTimeZone("2026-01-15T17:00:00.000Z", "America/Los_Angeles")).toBe(
      "2026-01-15T09:00",
    );
  });

  it("crosses the date line when needed", () => {
    // 16:00 UTC Jul 20 = 1:00 AM Jul 21 in Tokyo (UTC+9).
    expect(toLocalInputValueInTimeZone("2026-07-20T16:00:00.000Z", "Asia/Tokyo")).toBe(
      "2026-07-21T01:00",
    );
  });
});

describe("zonedDateTimeLocalToIso", () => {
  it("interprets the wall clock in the given zone (summer)", () => {
    expect(zonedDateTimeLocalToIso("2026-07-20T09:00", "America/Los_Angeles")).toBe(
      "2026-07-20T16:00:00.000Z",
    );
  });

  it("interprets the wall clock in the given zone (winter)", () => {
    expect(zonedDateTimeLocalToIso("2026-01-15T09:00", "America/Los_Angeles")).toBe(
      "2026-01-15T17:00:00.000Z",
    );
  });

  it("round-trips with toLocalInputValueInTimeZone", () => {
    const zones = ["America/New_York", "Europe/Paris", "Asia/Kolkata", "UTC"];
    for (const tz of zones) {
      const local = "2026-09-03T14:30";
      const iso = zonedDateTimeLocalToIso(local, tz);
      expect(toLocalInputValueInTimeZone(iso, tz)).toBe(local);
    }
  });
});

describe("zonedDayKey", () => {
  it("uses the zone's calendar day, not UTC's", () => {
    // 2:00 UTC Jul 21 is still Jul 20 in Los Angeles.
    expect(zonedDayKey("2026-07-21T02:00:00.000Z", "America/Los_Angeles")).toBe("2026-07-20");
    expect(zonedDayKey("2026-07-21T02:00:00.000Z", "UTC")).toBe("2026-07-21");
  });
});

describe("isOutsideEventDates", () => {
  const eventStart = "2026-07-20T16:00:00.000Z"; // Jul 20, 9 AM PDT
  const eventEnd = "2026-07-22T23:00:00.000Z"; // Jul 22, 4 PM PDT
  const tz = "America/Los_Angeles";

  it("accepts sessions inside the event window", () => {
    expect(
      isOutsideEventDates("2026-07-21T17:00:00.000Z", "2026-07-21T18:00:00.000Z", eventStart, eventEnd, tz),
    ).toBe(false);
  });

  it("accepts a session earlier the same day as the event start", () => {
    // 8 AM PDT on the event's first day — same calendar day, no warning.
    expect(
      isOutsideEventDates("2026-07-20T15:00:00.000Z", "2026-07-20T15:30:00.000Z", eventStart, eventEnd, tz),
    ).toBe(false);
  });

  it("flags a session the day before the event", () => {
    expect(
      isOutsideEventDates("2026-07-19T16:00:00.000Z", "2026-07-19T17:00:00.000Z", eventStart, eventEnd, tz),
    ).toBe(true);
  });

  it("flags a session ending after the event's last day", () => {
    expect(
      isOutsideEventDates("2026-07-22T23:00:00.000Z", "2026-07-23T17:00:00.000Z", eventStart, eventEnd, tz),
    ).toBe(true);
  });

  it("flags a mistyped year", () => {
    expect(
      isOutsideEventDates("2027-07-21T17:00:00.000Z", "2027-07-21T18:00:00.000Z", eventStart, eventEnd, tz),
    ).toBe(true);
  });
});
