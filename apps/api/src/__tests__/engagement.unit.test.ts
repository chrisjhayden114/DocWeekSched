import { describe, expect, it } from "vitest";
import {
  FEATURE_BY_KEY,
  getOrganizerVisibleFeatures,
  resolveEntitlement,
  planDefinitionForTier,
  resolveFeatureEnabled,
} from "@event-app/shared";
import { LIFETIME_POINTS_LABEL, sumEventEngagementActions } from "../lib/eventEngagement";

describe("Phase 5 entitlements & registry", () => {
  it("exposes polls, feedback, sponsors, checkin; leaderboard hidden (unbuilt) and default off", () => {
    expect(FEATURE_BY_KEY.session_polls).toBeTruthy();
    expect(FEATURE_BY_KEY.session_feedback).toBeTruthy();
    expect(FEATURE_BY_KEY.sponsors).toBeTruthy();
    expect(FEATURE_BY_KEY.checkin).toBeTruthy();
    expect(FEATURE_BY_KEY.public_leaderboard.plannedPhase).toBe("later");
    expect(FEATURE_BY_KEY.public_leaderboard.defaultOn).toBe(false);
    expect(getOrganizerVisibleFeatures().some((f) => f.key === "public_leaderboard")).toBe(false);
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

/**
 * FOSSIL-1 — per-event reports must not present the account-wide points
 * counter as this event's engagement.
 */
describe("event-scoped engagement (FOSSIL-1)", () => {
  it("sums only the event-scoped signals the caller supplied", () => {
    expect(
      sumEventEngagementActions({
        sessionJoins: 4,
        sessionLikes: 3,
        qaThreads: 1,
        pollVotes: 1,
        feedbackResponses: 2,
        checkIns: 2,
      }),
    ).toBe(13);
  });

  it("treats absent signals as zero rather than inventing them", () => {
    expect(sumEventEngagementActions({})).toBe(0);
    expect(sumEventEngagementActions({ messages: 5, communityThreads: undefined })).toBe(5);
  });

  it("labels the lifetime figure as account-wide, never per-event", () => {
    expect(LIFETIME_POINTS_LABEL).toMatch(/lifetime/i);
    expect(LIFETIME_POINTS_LABEL).toMatch(/not scoped to this event/i);
  });
});
