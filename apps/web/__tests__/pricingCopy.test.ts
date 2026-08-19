import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { speakerReadinessPilot } from "@event-app/config";
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
  formatPilotUsd,
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

  it("does not invent Speaker Readiness on public plans (INTERNAL only)", () => {
    expect(hasBullet("free", "Speaker Readiness")).toBe(false);
    expect(hasBullet("per_event_250", "Speaker Readiness")).toBe(false);
    expect(hasBullet("pro_monthly", "Speaker Readiness")).toBe(false);
    expect(hasBullet("enterprise", "Speaker Readiness")).toBe(false);
    expect(hasBullet("internal", "Speaker Readiness")).toBe(true);
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

  it("links the done-for-you answer to /speaker-readiness with pilot amounts from config", () => {
    const item = PRICING_FAQ.find((f) => f.q === "Is there a done-for-you option?");
    expect(item && "href" in item ? item.href : null).toBe("/speaker-readiness");
    expect(item?.a).toContain(formatPilotUsd(speakerReadinessPilot.small.priceUsd));
    expect(item?.a).toContain(String(speakerReadinessPilot.small.presentersApprox));
    expect(item?.a).toContain(formatPilotUsd(speakerReadinessPilot.medium.priceUsd));
    expect(item?.a).toContain(String(speakerReadinessPilot.medium.presentersApprox));
  });

  it("the page imports the shared copy and cross-links the concierge pilot", () => {
    const page = readFileSync(PAGE, "utf8");
    const copy = readFileSync(join(__dirname, "../lib/pricingCopy.ts"), "utf8");
    expect(page).toContain("planFeatureBullets");
    expect(page).toContain("PRICING_FAQ");
    expect(page).toContain("CONCIERGE_CROSS_LINK");
    expect(CONCIERGE_CROSS_LINK.href).toBe("/speaker-readiness");
    expect(CONCIERGE_CROSS_LINK.lead).toContain("Running one big event");
    expect(copy).toContain("speakerReadinessPilot.small.priceUsd");
    expect(copy).toContain("speakerReadinessPilot.medium.priceUsd");
    expect(copy).not.toMatch(/\$750/);
    expect(copy).not.toMatch(/\$1,?250/);
  });
});
