import { describe, expect, it } from "vitest";
import {
  FEATURE_BY_KEY,
  FEATURE_PRESETS,
  getOrganizerVisibleFeatures,
  resolveFeatureEnabled,
} from "../lib/features/registry";
import {
  PLAN_CATALOG,
  PLAN_BY_SKU,
  resolveEntitlement,
} from "@event-app/shared";

/**
 * ER1 — hidden entitlement. The `readiness` key must exist, default off,
 * stay invisible to organizers, and be granted by no public plan tier.
 */
describe("readiness feature key (ER1)", () => {
  it("is registered, off by default, and marked as a planned phase", () => {
    const def = FEATURE_BY_KEY.readiness;
    expect(def).toBeDefined();
    expect(def.defaultOn).toBe(false);
    expect(def.plannedPhase).toBeTruthy();
    expect(def.retired).toBeUndefined();
  });

  it("is hidden from the organizer Features tab and wizard", () => {
    const visible = getOrganizerVisibleFeatures();
    expect(visible.some((f) => f.key === "readiness")).toBe(false);
  });

  it("resolves off by default and stays off when the plan disallows it", () => {
    expect(resolveFeatureEnabled("readiness", {})).toBe(false);
    // Organizer override alone is not enough: effective = plan AND override.
    expect(resolveFeatureEnabled("readiness", { readiness: true }, { planAllows: false })).toBe(false);
    // Entitled org (INTERNAL) that explicitly enables it: on.
    expect(resolveFeatureEnabled("readiness", { readiness: true }, { planAllows: true })).toBe(true);
    // Entitled but not enabled: still off (defaultOn false).
    expect(resolveFeatureEnabled("readiness", {}, { planAllows: true })).toBe(false);
  });

  it("is granted by no public plan tier — INTERNAL only", () => {
    for (const plan of PLAN_CATALOG.filter((p) => p.tier !== "INTERNAL")) {
      expect(resolveEntitlement(plan, "readiness"), `tier ${plan.sku}`).toBe(false);
    }
    expect(resolveEntitlement(PLAN_BY_SKU.internal, "readiness")).toBe(true);
  });

  it("is not flipped on by any wizard preset", () => {
    for (const preset of FEATURE_PRESETS) {
      expect(preset.overrides.readiness, `preset ${preset.id}`).toBeUndefined();
    }
  });
});
