import { describe, expect, it } from "vitest";
import {
  applyPreset,
  normalizeOverridesForSave,
  resolveFeatureEnabled,
} from "../lib/features/registry";

describe("featureEnabled precedence (resolveFeatureEnabled)", () => {
  it("uses registry defaults when overrides are empty", () => {
    expect(resolveFeatureEnabled("community", {})).toBe(true);
    expect(resolveFeatureEnabled("session_qa", {})).toBe(true);
    expect(resolveFeatureEnabled("matchmaker", {})).toBe(false);
    expect(resolveFeatureEnabled("public_leaderboard", {})).toBe(false);
  });

  it("applies event overrides over defaults", () => {
    expect(resolveFeatureEnabled("community", { community: false })).toBe(false);
    expect(resolveFeatureEnabled("session_likes", { session_likes: false })).toBe(false);
    expect(resolveFeatureEnabled("timezone_toggle", { timezone_toggle: false })).toBe(false);
  });

  it("AND-gates plan entitlement when planAllows is false", () => {
    expect(resolveFeatureEnabled("community", {}, { planAllows: false })).toBe(false);
    expect(resolveFeatureEnabled("community", { community: true }, { planAllows: false })).toBe(false);
    expect(resolveFeatureEnabled("community", { community: true }, { planAllows: true })).toBe(true);
  });
});

describe("dependency cascade", () => {
  it("community-off hides child channels even if their override is true", () => {
    expect(
      resolveFeatureEnabled("community_icebreakers", {
        community: false,
        community_icebreakers: true,
      }),
    ).toBe(false);
    expect(
      resolveFeatureEnabled("community_moments", {
        community: false,
        community_moments: true,
      }),
    ).toBe(false);
  });

  it("directory-off disables matchmaker with explanation on save", () => {
    expect(
      resolveFeatureEnabled("matchmaker", {
        attendee_directory: false,
        matchmaker: true,
      }),
    ).toBe(false);

    const { overrides, forcedOff } = normalizeOverridesForSave({
      attendee_directory: false,
      matchmaker: true,
    });
    expect(overrides.matchmaker).toBe(false);
    expect(forcedOff.some((f) => f.key === "matchmaker")).toBe(true);
    expect(forcedOff.find((f) => f.key === "matchmaker")?.reason).toMatch(/directory/i);
  });

  it("normalizeOverridesForSave forces community children off when community is off", () => {
    const { overrides } = normalizeOverridesForSave({
      community: false,
      community_meetups: true,
      community_general: true,
    });
    expect(overrides.community_meetups).toBe(false);
    expect(overrides.community_general).toBe(false);
  });
});

describe("wizard presets", () => {
  it("applies Everything on", () => {
    const o = applyPreset("everything");
    expect(o.community).toBe(true);
    expect(o.messaging_dms).toBe(true);
    expect(o.session_qa).toBe(true);
    expect(o.attendee_directory).toBe(true);
  });

  it("applies Focused (agenda + Q&A, networking off)", () => {
    const o = applyPreset("focused");
    expect(o.community).toBe(false);
    expect(o.messaging_dms).toBe(false);
    expect(o.session_qa).toBe(true);
    expect(o.attendee_directory).toBe(false);
    expect(resolveFeatureEnabled("community_icebreakers", o)).toBe(false);
  });

  it("applies Academic program (moments and leaderboard off)", () => {
    const o = applyPreset("academic");
    expect(o.community).toBe(true);
    expect(o.community_moments).toBe(false);
    expect(o.public_leaderboard).toBe(false);
    expect(resolveFeatureEnabled("community_moments", o)).toBe(false);
    expect(resolveFeatureEnabled("community_meetups", o)).toBe(true);
  });
});
