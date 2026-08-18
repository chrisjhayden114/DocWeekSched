import { describe, expect, it } from "vitest";
import {
  MEMBERSHIP_PURGE_AFTER_MS,
  membershipPurgeCutoff,
} from "../lib/memberships/purgeWindow";

describe("membershipPurgeCutoff", () => {
  it("is 30 days before the given instant", () => {
    const now = new Date("2026-08-18T12:00:00.000Z");
    expect(MEMBERSHIP_PURGE_AFTER_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(membershipPurgeCutoff(now).toISOString()).toBe("2026-07-19T12:00:00.000Z");
  });
});
