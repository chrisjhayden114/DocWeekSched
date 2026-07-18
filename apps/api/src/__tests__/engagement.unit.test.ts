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

describe("Phase P4 entitlements & registry", () => {
  it("registers certificates as an attendee feature; badges is plan-flag only", () => {
    expect(FEATURE_BY_KEY.certificates).toBeTruthy();
    expect(FEATURE_BY_KEY.certificates.defaultOn).toBe(true);
    expect(getOrganizerVisibleFeatures().some((f) => f.key === "certificates")).toBe(true);
    expect(resolveFeatureEnabled("certificates", {})).toBe(true);
    expect(FEATURE_BY_KEY.certificates).toBeTruthy();
    // badges is PlanFlagKey — not in feature registry
    expect((FEATURE_BY_KEY as Record<string, unknown>).badges).toBeUndefined();
  });

  it("gates badges and certificates on PER_EVENT and PRO, not FREE", () => {
    expect(resolveEntitlement(planDefinitionForTier("FREE"), "badges")).toBe(false);
    expect(resolveEntitlement(planDefinitionForTier("FREE"), "certificates")).toBe(false);

    expect(resolveEntitlement(planDefinitionForTier("PER_EVENT"), "badges")).toBe(true);
    expect(resolveEntitlement(planDefinitionForTier("PER_EVENT"), "certificates")).toBe(true);

    expect(resolveEntitlement(planDefinitionForTier("PRO"), "badges")).toBe(true);
    expect(resolveEntitlement(planDefinitionForTier("PRO"), "certificates")).toBe(true);
  });
});
