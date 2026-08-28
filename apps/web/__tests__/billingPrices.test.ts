/**
 * K-2 — billing upgrade buttons must show catalog prices, never typed amounts.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatDisplayPrice, PLAN_BY_SKU, PLAN_CATALOG } from "@event-app/shared";

const PAGE = readFileSync(join(__dirname, "../pages/organizer/billing.tsx"), "utf8");

describe("billing upgrade buttons (K-2)", () => {
  it("derives labels from PLAN_BY_SKU + formatDisplayPrice", () => {
    expect(PAGE).toContain("PLAN_BY_SKU");
    expect(PAGE).toContain("PLAN_CATALOG");
    expect(PAGE).toContain("formatDisplayPrice");
    expect(PAGE).toContain("plan.displayPriceCents");
    expect(PAGE).toContain("plan.limits.attendees");
    expect(PAGE).toContain("plan.limits.activeEvents");
    expect(PAGE).toContain("plan.limits.aiIngestPerEvent");
    expect(PAGE).not.toContain("UPGRADE_SKUS");
  });

  it("does not hardcode display amounts on the billing page", () => {
    expect(PAGE).not.toMatch(/\$\d/);
    expect(PAGE).not.toMatch(/\b14900\b/);
    expect(PAGE).not.toMatch(/\b24900\b/);
    expect(PAGE).not.toMatch(/\b39900\b/);
    expect(PAGE).not.toMatch(/\b7900\b/);
    expect(PAGE).not.toMatch(/\b79000\b/);
    for (const plan of PLAN_CATALOG) {
      if (plan.displayPriceCents == null || plan.displayPriceCents === 0) continue;
      const formatted = formatDisplayPrice(plan.displayPriceCents, plan.currency, plan.interval);
      expect(PAGE, plan.sku).not.toContain(formatted);
      expect(PLAN_BY_SKU[plan.sku].displayPriceCents).toBe(plan.displayPriceCents);
    }
  });
});
