import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { speakerReadinessService } from "@event-app/config";
import {
  ASSISTANT_COPY,
  PLAN_BY_SKU,
  publicPricingPlans,
  resolveEntitlement,
  type EntitlementKey,
} from "@event-app/shared";
import {
  CONCIERGE_CROSS_LINK,
  FULL_AI_SUITE_BULLET,
  FULL_AI_SUITE_DETAIL,
  PRICING_FAQ,
  planFeatureBullets,
} from "../lib/pricingCopy";

const PAGE = join(__dirname, "../pages/pricing.tsx");

function hasBullet(planSku: keyof typeof PLAN_BY_SKU, needle: string | RegExp): boolean {
  const rows = planFeatureBullets(PLAN_BY_SKU[planSku]);
  return rows.some((row) => (typeof needle === "string" ? row.includes(needle) : needle.test(row)));
}

describe("pricing copy (MKT-3) — entitlement-driven bullets", () => {
  it("lists majors that the catalog does not gate on every public plan", () => {
    for (const plan of publicPricingPlans()) {
      const rows = planFeatureBullets(plan);
      expect(rows.some((r) => r.includes("Agenda import")), plan.sku).toBe(
        resolveEntitlement(plan, "ai_ingest"),
      );
      expect(rows.some((r) => r.includes("Excel")), plan.sku).toBe(true);
      expect(rows.some((r) => r.includes("CFP with blind review")), plan.sku).toBe(true);
      expect(rows.some((r) => r.includes("Registration fees")), plan.sku).toBe(
        resolveEntitlement(plan, "paid_attendance"),
      );
      expect(rows.some((r) => r.includes("Venue maps")), plan.sku).toBe(
        resolveEntitlement(plan, "venue_maps"),
      );
      expect(rows.some((r) => r === "Announcements"), plan.sku).toBe(true);
    }
  });

  it("shows gated majors only where resolveEntitlement says so", () => {
    const gated: Array<{ key: EntitlementKey; needle: string | RegExp }> = [
      { key: "certificates", needle: "Certificates" },
      { key: "badges", needle: "Badges" },
      { key: "checkin", needle: "QR check-in" },
      { key: "sponsors", needle: "Sponsors and lead capture" },
      { key: "sponsor_outreach", needle: "Sponsor outreach" },
      { key: "paid_attendance", needle: "Registration fees" },
      { key: "analytics", needle: "Analytics" },
      { key: "session_polls", needle: "Polls and surveys" },
      { key: "ai_full_suite", needle: /^Full AI suite/ },
      { key: "readiness", needle: "Speaker Readiness" },
      { key: "sso", needle: "SSO" },
      { key: "white_label", needle: "White-label" },
      { key: "priority_support", needle: "Priority support" },
    ];
    for (const plan of publicPricingPlans()) {
      const rows = planFeatureBullets(plan);
      for (const { key, needle } of gated) {
        const shown = rows.some((row) =>
          typeof needle === "string" ? row === needle || row.includes(needle) : needle.test(row),
        );
        expect(shown, `${plan.sku} ${key}`).toBe(resolveEntitlement(plan, key));
      }
    }
  });

  it("lists registration fees on every card (CORE / paid_attendance)", () => {
    for (const plan of publicPricingPlans()) {
      expect(hasBullet(plan.sku, "Registration fees"), plan.sku).toBe(true);
    }
    expect(planFeatureBullets(PLAN_BY_SKU.free)).toContain(
      "Registration fees — publish price and payment instructions, track who's paid",
    );
  });

  it("lists sponsor outreach on every card, and names the Free prospect cap", () => {
    for (const plan of publicPricingPlans()) {
      expect(hasBullet(plan.sku, "Sponsor outreach"), plan.sku).toBe(true);
    }
    const freeCap = PLAN_BY_SKU.free.limits.outreachProspectsPerEvent;
    expect(freeCap).not.toBeNull();
    expect(planFeatureBullets(PLAN_BY_SKU.free)).toContain(
      `Sponsor outreach (${freeCap!.toLocaleString()} prospects per event)`,
    );
    const copy = readFileSync(join(__dirname, "../lib/pricingCopy.ts"), "utf8");
    expect(copy).toContain("outreachProspectsPerEvent");
    expect(copy).not.toMatch(/25 prospects/);
    for (const sku of ["per_event_250", "pro_monthly", "enterprise"] as const) {
      expect(planFeatureBullets(PLAN_BY_SKU[sku]), sku).toContain("Sponsor outreach");
      expect(
        planFeatureBullets(PLAN_BY_SKU[sku]).some((row) => row.includes("prospects per event")),
        sku,
      ).toBe(false);
    }
  });

  it("lists Speaker Readiness on every card, and names the Free presenter cap (ER-GA)", () => {
    for (const plan of publicPricingPlans()) {
      expect(hasBullet(plan.sku, "Speaker Readiness"), plan.sku).toBe(true);
    }
    const freeCap = PLAN_BY_SKU.free.limits.readinessPresentersPerEvent;
    expect(freeCap).not.toBeNull();
    expect(planFeatureBullets(PLAN_BY_SKU.free)).toContain(
      `Speaker Readiness (up to ${freeCap} presenters)`,
    );
    // Uncapped tiers must not imply a cap they do not have.
    for (const sku of ["per_event_250", "pro_monthly", "enterprise"] as const) {
      expect(planFeatureBullets(PLAN_BY_SKU[sku]), sku).toContain("Speaker Readiness");
    }
  });

  it("keeps paid-only majors off Free and on per-event / Pro", () => {
    expect(hasBullet("free", "Certificates")).toBe(false);
    expect(hasBullet("free", "QR check-in")).toBe(false);
    expect(hasBullet("free", "Full AI suite")).toBe(false);
    expect(hasBullet("per_event_250", "Certificates")).toBe(true);
    expect(hasBullet("per_event_250", "QR check-in")).toBe(true);
    expect(hasBullet("per_event_250", "Full AI suite")).toBe(false);
    expect(hasBullet("pro_monthly", "Certificates")).toBe(true);
    expect(hasBullet("pro_monthly", "Full AI suite")).toBe(true);
  });

  it("defines Full AI suite where it appears", () => {
    expect(FULL_AI_SUITE_DETAIL).toContain("program ingest");
    expect(FULL_AI_SUITE_DETAIL).toContain("describe-your-event drafts");
    expect(FULL_AI_SUITE_DETAIL).toContain(`${ASSISTANT_COPY.attendee.name} for attendees`);
    expect(FULL_AI_SUITE_DETAIL).toContain(ASSISTANT_COPY.organizer.name);
    expect(FULL_AI_SUITE_DETAIL).toContain("ops drafts and recap");
    expect(FULL_AI_SUITE_BULLET.startsWith("Full AI suite (")).toBe(true);
    expect(planFeatureBullets(PLAN_BY_SKU.pro_monthly)).toContain(FULL_AI_SUITE_BULLET);
    expect(planFeatureBullets(PLAN_BY_SKU.free)).not.toContain(FULL_AI_SUITE_BULLET);
  });

  it("names the Event assistant on plans that do not include the full suite", () => {
    const free = planFeatureBullets(PLAN_BY_SKU.free);
    const pro = planFeatureBullets(PLAN_BY_SKU.pro_monthly);
    expect(free).toContain(`${ASSISTANT_COPY.attendee.name} for attendees`);
    expect(free).toContain(ASSISTANT_COPY.organizer.name);
    expect(pro).not.toContain(`${ASSISTANT_COPY.attendee.name} for attendees`);
    expect(pro).toContain(FULL_AI_SUITE_BULLET);
  });
});

describe("pricing copy (MKT-3) — FAQ and concierge cross-link", () => {
  const questions = PRICING_FAQ.map((item) => item.q);

  it("keeps the existing FAQ entries and adds the three MKT-3 questions", () => {
    expect(questions.slice(0, 5)).toEqual([
      "What counts as an attendee?",
      "How do refunds work?",
      "What happens when I archive an event?",
      "What is the recurring-event price lock?",
      "What happens to a published event if I cancel Pro?",
    ]);
    expect(questions).toContain("Do presenters need accounts?");
    expect(questions).toContain("What happens when the program changes?");
    expect(questions).toContain("Is there a done-for-you option?");
  });

  it("says presenters get a personal link and do not count toward the attendee cap", () => {
    const item = PRICING_FAQ.find((f) => f.q === "Do presenters need accounts?");
    expect(item?.a.toLowerCase()).toContain("no");
    expect(item?.a).toMatch(/personal link/i);
    expect(item?.a.toLowerCase()).toContain("do not count toward the attendee cap");
  });

  it("says program edits publish in minutes", () => {
    const item = PRICING_FAQ.find((f) => f.q === "What happens when the program changes?");
    expect(item?.a.toLowerCase()).toContain("publish");
    expect(item?.a.toLowerCase()).toContain("minutes");
  });

  it("links the done-for-you answer to /speaker-readiness with every service rate from config", () => {
    const item = PRICING_FAQ.find((f) => f.q === "Is there a done-for-you option?");
    expect(item && "href" in item ? item.href : null).toBe("/speaker-readiness");
    // A service, not a licence: the answer must not imply the software is bought.
    expect(item?.a).toContain("included in every plan");
    for (const tier of speakerReadinessService.tiers) {
      expect(item?.a, tier.id).toContain(tier.scale);
      expect(item?.a, tier.id).toContain(tier.price);
    }
  });

  it("the page imports the shared copy and cross-links the concierge rates", () => {
    const page = readFileSync(PAGE, "utf8");
    const copy = readFileSync(join(__dirname, "../lib/pricingCopy.ts"), "utf8");
    expect(page).toContain("planFeatureBullets");
    expect(page).toContain("PRICING_FAQ");
    expect(page).toContain("CONCIERGE_CROSS_LINK");
    expect(CONCIERGE_CROSS_LINK.href).toBe("/speaker-readiness");
    expect(CONCIERGE_CROSS_LINK.lead).toContain("Running one big event");
    // Every amount comes from config — no rate is typed into this module.
    expect(copy).toContain("speakerReadinessService.tiers");
    for (const tier of speakerReadinessService.tiers) {
      expect(copy, tier.id).not.toContain(tier.price);
    }
  });
});
