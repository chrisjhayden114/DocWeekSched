import { describe, expect, it } from "vitest";
import {
  classForKind,
  dailyPushBudgetCeiling,
} from "../lib/notifications";
import { NotificationKind, NotificationClass } from "@prisma/client";
import {
  isInQuietHours,
  localDayKey,
  nextQuietHoursEnd,
  parseHm,
  zonedWallTimeToUtc,
} from "../lib/notifications/timezone";

describe("calm notification class routing", () => {
  it("maps kinds to INTERRUPT vs DIGEST", () => {
    expect(classForKind(NotificationKind.MESSAGE)).toBe(NotificationClass.INTERRUPT);
    expect(classForKind(NotificationKind.ANNOUNCEMENT)).toBe(NotificationClass.INTERRUPT);
    expect(classForKind(NotificationKind.SESSION_CHANGED)).toBe(NotificationClass.INTERRUPT);
    expect(classForKind(NotificationKind.COMMUNITY_THREAD)).toBe(NotificationClass.DIGEST);
    expect(classForKind(NotificationKind.COMMUNITY_REPLY)).toBe(NotificationClass.DIGEST);
    expect(classForKind(NotificationKind.DIGEST_ROLLUP)).toBe(NotificationClass.DIGEST);
  });

  it("reads push budget ceiling from env with default 5", () => {
    const prev = process.env.NOTIFICATION_DAILY_PUSH_BUDGET;
    delete process.env.NOTIFICATION_DAILY_PUSH_BUDGET;
    expect(dailyPushBudgetCeiling()).toBe(5);
    process.env.NOTIFICATION_DAILY_PUSH_BUDGET = "3";
    expect(dailyPushBudgetCeiling()).toBe(3);
    if (prev === undefined) delete process.env.NOTIFICATION_DAILY_PUSH_BUDGET;
    else process.env.NOTIFICATION_DAILY_PUSH_BUDGET = prev;
  });
});

describe("quiet hours (attendee-local)", () => {
  it("parses HH:mm", () => {
    expect(parseHm("22:00")).toBe(22 * 60);
    expect(parseHm("07:30")).toBe(7 * 60 + 30);
  });

  it("detects overnight quiet window in America/New_York", () => {
    // 2027-01-15 03:00 EST = 08:00 UTC
    const lateNight = new Date("2027-01-15T04:00:00Z"); // 23:00 EST previous evening... 
    // Use a known wall time via zonedWallTimeToUtc
    const at2300 = zonedWallTimeToUtc("America/New_York", 2027, 1, 15, 23, 0);
    const at0300 = zonedWallTimeToUtc("America/New_York", 2027, 1, 16, 3, 0);
    const at1000 = zonedWallTimeToUtc("America/New_York", 2027, 1, 16, 10, 0);
    expect(isInQuietHours(at2300, "America/New_York", "22:00", "07:00")).toBe(true);
    expect(isInQuietHours(at0300, "America/New_York", "22:00", "07:00")).toBe(true);
    expect(isInQuietHours(at1000, "America/New_York", "22:00", "07:00")).toBe(false);
  });

  it("queues until local morning end", () => {
    const at2300 = zonedWallTimeToUtc("America/New_York", 2027, 6, 10, 23, 15);
    const end = nextQuietHoursEnd(at2300, "America/New_York", "22:00", "07:00");
    expect(end).not.toBeNull();
    const day = localDayKey(end!, "America/New_York");
    expect(day).toBe("2027-06-11");
  });

  it("holds across three timezones", () => {
    const zones = ["America/Los_Angeles", "America/New_York", "Europe/London"];
    for (const tz of zones) {
      const quiet = zonedWallTimeToUtc(tz, 2027, 3, 20, 23, 30);
      const awake = zonedWallTimeToUtc(tz, 2027, 3, 21, 12, 0);
      expect(isInQuietHours(quiet, tz, "22:00", "07:00")).toBe(true);
      expect(isInQuietHours(awake, tz, "22:00", "07:00")).toBe(false);
    }
  });
});

describe("session starting soon", () => {
  it("maps kind to INTERRUPT", () => {
    expect(classForKind(NotificationKind.SESSION_STARTING_SOON)).toBe(NotificationClass.INTERRUPT);
  });

  it("opens 15–20 minutes ahead by default", async () => {
    const { sessionStartingSoonWindow } = await import("../lib/notifications/sessionStartingSoon");
    const now = new Date("2027-06-01T12:00:00Z");
    const { from, to } = sessionStartingSoonWindow(now);
    expect(from.toISOString()).toBe("2027-06-01T12:15:00.000Z");
    expect(to.toISOString()).toBe("2027-06-01T12:20:00.000Z");
  });
});
