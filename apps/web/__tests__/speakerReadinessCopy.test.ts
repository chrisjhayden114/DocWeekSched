import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { readinessReminderCopy, speakerReadinessService } from "@event-app/config";
import { PLAN_BY_SKU } from "@event-app/shared";

const PAGE = join(__dirname, "../pages/speaker-readiness.tsx");
const MAIL = join(__dirname, "../../api/src/lib/mail.ts");

describe("Speaker Readiness reminder copy stays in sync (MKT-2)", () => {
  it("pins the ER5 strings the builder and the marketing mock share", () => {
    expect(readinessReminderCopy.subjectDue("DocWeek 2027")).toBe("Reminder: materials due for DocWeek 2027");
    expect(readinessReminderCopy.alreadySent).toBe(
      "Already sent these? Your organizer may still be reviewing — no action needed.",
    );
    expect(readinessReminderCopy.linkExpiryNote).toBe(
      "This link works for 30 days. Links from earlier emails keep working until their own expiry.",
    );
    expect(readinessReminderCopy.itemNoDue).toBe("no due date");
  });

  it("the page and the reminder builder both import readinessReminderCopy", () => {
    const page = readFileSync(PAGE, "utf8");
    const mail = readFileSync(MAIL, "utf8");
    expect(page).toContain("readinessReminderCopy");
    expect(page).toContain("subjectDue");
    expect(page).toContain("alreadySent");
    expect(page).toContain("linkExpiryNote");
    expect(mail).toContain("readinessReminderCopy");
    expect(mail).toContain("subjectDue");
    expect(mail).toContain("alreadySent");
    expect(mail).toContain("linkExpiryNote");
  });

  it("pins the four concierge service rates (founder decision 2026-08-26)", () => {
    expect(
      speakerReadinessService.tiers.map((tier) => [tier.name, tier.scale, tier.price]),
    ).toEqual([
      ["Community & small events", "Community conferences, PD days, talk showcases — under 50 attendees", "$150"],
      ["Community & small events", "50–150 attendees", "$350"],
      ["Standard concierge", "150–500 attendees", "$750"],
      ["Large or complex", "500+ attendees, multi-track associations", "from $1,250"],
    ]);
    expect(speakerReadinessService.tiers[3]!.priceNote).toBe("individually scoped");
    // One promise, identical on every tier — the page renders it once.
    for (const tier of speakerReadinessService.tiers) {
      expect(tier.description, tier.id).toBe(speakerReadinessService.promise);
    }
    expect(speakerReadinessService.promise).toBe(
      "We map your data, build your templates, send the invites, and stay hands-on through your event — direct founder support.",
    );
    expect(readFileSync(PAGE, "utf8")).toContain("speakerReadinessService");
  });

  it("the page says Readiness ships with every plan instead of asking for an email", () => {
    const page = readFileSync(PAGE, "utf8");
    expect(page).toContain("Included in every plan");
    expect(page).toContain("Features");
    // The Free cap is read from the catalog, never typed into the page.
    expect(page).toContain("PLAN_BY_SKU.free.limits.readinessPresentersPerEvent");
    expect(PLAN_BY_SKU.free.limits.readinessPresentersPerEvent).toBe(10);
    // The concierge mailto stays; nothing else may imply email-to-enable.
    expect(page).toContain("speakerReadinessServiceMailto");
    expect(page).toContain("Want it done with you?");
  });

  it("the homepage flagship section no longer implies emailing to get Readiness", () => {
    const home = readFileSync(join(__dirname, "../pages/index.tsx"), "utf8");
    expect(home).not.toContain("speakerReadinessPilotMailto");
    expect(home).not.toMatch(/Ask about a Speaker Readiness/);
    expect(home).toContain("In every plan — Free includes your first 10 presenters.");
  });
});
