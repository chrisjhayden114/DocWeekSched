import { describe, expect, it } from "vitest";
import {
  FEATURE_BY_KEY,
  getOrganizerVisibleFeatures,
  resolveEntitlement,
  planDefinitionForTier,
  resolveFeatureEnabled,
} from "@event-app/shared";

describe("Phase 5 entitlements & registry", () => {
  it("exposes polls, feedback, sponsors, checkin; leaderboard visible and default off", () => {
    expect(FEATURE_BY_KEY.session_polls).toBeTruthy();
    expect(FEATURE_BY_KEY.session_feedback).toBeTruthy();
    expect(FEATURE_BY_KEY.sponsors).toBeTruthy();
    expect(FEATURE_BY_KEY.checkin).toBeTruthy();
    expect(FEATURE_BY_KEY.public_leaderboard.plannedPhase).toBeUndefined();
    expect(FEATURE_BY_KEY.public_leaderboard.defaultOn).toBe(false);
    expect(getOrganizerVisibleFeatures().some((f) => f.key === "public_leaderboard")).toBe(true);
    expect(resolveFeatureEnabled("public_leaderboard", {})).toBe(false);
  });

  it("gates analytics and engagement suite on PER_EVENT and PRO, not FREE", () => {
    expect(resolveEntitlement(planDefinitionForTier("FREE"), "analytics")).toBe(false);
    expect(resolveEntitlement(planDefinitionForTier("FREE"), "session_polls")).toBe(false);
    expect(resolveEntitlement(planDefinitionForTier("FREE"), "checkin")).toBe(false);

    expect(resolveEntitlement(planDefinitionForTier("PER_EVENT"), "analytics")).toBe(true);
    expect(resolveEntitlement(planDefinitionForTier("PER_EVENT"), "session_polls")).toBe(true);
    expect(resolveEntitlement(planDefinitionForTier("PER_EVENT"), "sponsors")).toBe(true);
    expect(resolveEntitlement(planDefinitionForTier("PER_EVENT"), "checkin")).toBe(true);

    expect(resolveEntitlement(planDefinitionForTier("PRO"), "analytics")).toBe(true);
    expect(resolveEntitlement(planDefinitionForTier("PRO"), "session_feedback")).toBe(true);
  });
});
