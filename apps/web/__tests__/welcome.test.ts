import { describe, expect, it } from "vitest";
import { shouldShowWelcome } from "../lib/welcome";

describe("shouldShowWelcome", () => {
  it("shows for an attendee who has not seen it and is not an admin", () => {
    expect(shouldShowWelcome({ role: "ATTENDEE", welcomeSeenAt: null, isAdmin: false })).toBe(true);
  });

  it("hides when membership role is not ATTENDEE", () => {
    expect(shouldShowWelcome({ role: "ADMIN", welcomeSeenAt: null, isAdmin: false })).toBe(false);
    expect(shouldShowWelcome({ role: "SPEAKER", welcomeSeenAt: null, isAdmin: false })).toBe(false);
  });

  it("hides once welcomeSeenAt is stamped", () => {
    expect(
      shouldShowWelcome({
        role: "ATTENDEE",
        welcomeSeenAt: "2026-08-13T00:00:00.000Z",
        isAdmin: false,
      }),
    ).toBe(false);
  });

  it("hides when isAdmin even if membership role is ATTENDEE", () => {
    expect(shouldShowWelcome({ role: "ATTENDEE", welcomeSeenAt: null, isAdmin: true })).toBe(false);
  });
});
