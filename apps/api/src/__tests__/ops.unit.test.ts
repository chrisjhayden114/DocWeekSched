import { describe, expect, it } from "vitest";
import { isOpsInboxActive, opsInboxWindow } from "../lib/ai/ops/window";
import { lowCheckinWindow } from "../lib/ai/ops/detectors/lowCheckin";
import { QA_STALE_HOURS, CAPACITY_PRESSURE_THRESHOLD, LOW_CHECKIN_THRESHOLD } from "../lib/ai/ops/types";
import { isEventCalendarDay } from "../lib/ai/ops/time";
import * as fs from "fs";
import * as path from "path";

describe("Ops agent window + thresholds (unit)", () => {
  it("Ops Inbox active 48h before start through 24h after end", () => {
    const start = new Date("2026-07-20T09:00:00Z");
    const end = new Date("2026-07-22T17:00:00Z");
    const event = { startDate: start, endDate: end };
    const { openAt, closeAt } = opsInboxWindow(event);

    expect(isOpsInboxActive(event, new Date(openAt.getTime() - 1))).toBe(false);
    expect(isOpsInboxActive(event, openAt)).toBe(true);
    expect(isOpsInboxActive(event, start)).toBe(true);
    expect(isOpsInboxActive(event, end)).toBe(true);
    expect(isOpsInboxActive(event, closeAt)).toBe(true);
    expect(isOpsInboxActive(event, new Date(closeAt.getTime() + 1))).toBe(false);
  });

  it("low-checkin window centers ~30 minutes before now+lead", () => {
    const now = new Date("2026-07-20T12:00:00Z");
    const { from, to } = lowCheckinWindow(now, 30, 10);
    expect(to.getTime() - from.getTime()).toBe(10 * 60_000);
    const mid = (from.getTime() + to.getTime()) / 2;
    expect(mid).toBe(now.getTime() + 30 * 60_000);
  });

  it("exposes documented thresholds", () => {
    expect(QA_STALE_HOURS).toBe(3);
    expect(LOW_CHECKIN_THRESHOLD).toBe(0.25);
    expect(CAPACITY_PRESSURE_THRESHOLD).toBe(0.9);
  });

  it("event calendar day is inclusive in event timezone", () => {
    const event = {
      startDate: new Date("2026-07-20T15:00:00Z"), // morning in US/Pacific-ish depending
      endDate: new Date("2026-07-22T01:00:00Z"),
      timezone: "UTC",
    };
    expect(isEventCalendarDay(new Date("2026-07-20T12:00:00Z"), event)).toBe(true);
    expect(isEventCalendarDay(new Date("2026-07-19T12:00:00Z"), event)).toBe(false);
    expect(isEventCalendarDay(new Date("2026-07-23T12:00:00Z"), event)).toBe(false);
  });
});

describe("Ops agent zero autonomous sends (static)", () => {
  it("detector modules never import applyOpsCard", () => {
    const dir = path.join(__dirname, "../lib/ai/ops/detectors");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts"));
    for (const file of files) {
      const src = fs.readFileSync(path.join(dir, file), "utf8");
      expect(src.includes("applyOpsCard")).toBe(false);
      expect(src.includes("notifyMany")).toBe(false);
      expect(src.includes("notifyNewMessage")).toBe(false);
    }
  });

  it("jobs module never applies cards", () => {
    const src = fs.readFileSync(path.join(__dirname, "../lib/ai/ops/jobs.ts"), "utf8");
    expect(src.includes("applyOpsCard")).toBe(false);
    expect(src.includes("runOpsDetectorsForEvent")).toBe(true);
  });
});
