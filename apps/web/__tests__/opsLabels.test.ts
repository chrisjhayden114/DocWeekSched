import { describe, expect, it } from "vitest";
import { opsActionLabel, opsDetectorLabel } from "../lib/opsLabels";

describe("Ops Inbox labels (E16.4)", () => {
  it("maps every known detector kind to plain English", () => {
    expect(opsDetectorLabel("DAILY_DIGEST")).toBe("Daily digest");
    expect(opsDetectorLabel("SESSION_CHANGED")).toBe("Schedule change");
    expect(opsDetectorLabel("QA_STALE")).toBe("Unanswered questions");
    expect(opsDetectorLabel("LOW_CHECKIN")).toBe("Low check-in");
    expect(opsDetectorLabel("CAPACITY_PRESSURE")).toBe("Session near capacity");
    expect(opsDetectorLabel("MODERATION")).toBe("Moderation");
  });

  it("maps every known action type", () => {
    expect(opsActionLabel("DIGEST_NOTE")).toBe("Digest note");
    expect(opsActionLabel("ANNOUNCEMENT")).toBe("Announcement draft");
    expect(opsActionLabel("ROOM_MOVE")).toBe("Room move suggestion");
  });

  it("never echoes a raw enum for unknown values", () => {
    expect(opsDetectorLabel("SOME_NEW_KIND")).toBe("Some new kind");
    expect(opsActionLabel("SOME_NEW_ACTION")).toBe("Some new action");
  });
});
