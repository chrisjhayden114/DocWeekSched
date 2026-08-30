/**
 * SPX-0 / SPX-1 — sponsor outreach pipeline + composer (pure).
 * UKEDL never sends these emails.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  buildOutreachMailto,
  dryRunOutreachCsv,
  lastContactedAtForStatusChange,
  OUTREACH_STARTER_TEMPLATE,
  PLAN_BY_SKU,
  resolveEntitlement,
  resolveOutreachMergeFields,
  suggestOutreachCsvMapping,
} from "@event-app/shared";
import { FEATURE_BY_KEY } from "../lib/features/registry";
import { draftOutreachEmail, outreachEventContext } from "../lib/ai/outreach/draft";
import { MockAiProvider, resetAiProviderForTests } from "../lib/ai";

describe("SPX-0 — feature + plan catalog", () => {
  it("registers sponsor_outreach under Sponsors, same tier, default on", () => {
    const def = FEATURE_BY_KEY.sponsor_outreach;
    expect(def.dependsOn).toEqual(["sponsors"]);
    expect(def.category).toBe("engagement");
    expect(def.defaultOn).toBe(true);
    expect(def.plainDescription).toMatch(/Sponsors hear from you, not from us/i);
  });

  it("caps Free at 25 prospects and leaves paid tiers uncapped", () => {
    expect(PLAN_BY_SKU.free.limits.outreachProspectsPerEvent).toBe(25);
    expect(PLAN_BY_SKU.free.entitlements.sponsor_outreach).toBe(true);
    for (const sku of [
      "per_event_250",
      "per_event_500",
      "per_event_1000",
      "pro_monthly",
      "pro_annual",
      "enterprise",
      "internal",
    ] as const) {
      expect(PLAN_BY_SKU[sku].limits.outreachProspectsPerEvent, sku).toBeNull();
      expect(PLAN_BY_SKU[sku].entitlements.sponsor_outreach, sku).toBe(true);
    }
  });

  it("Free resolves sponsor_outreach on with the 25-prospect cap (GUIDE-1 / DESIGN_PHASE_K)", () => {
    expect(resolveEntitlement(PLAN_BY_SKU.free, "sponsor_outreach")).toBe(true);
    expect(PLAN_BY_SKU.free.limits.outreachProspectsPerEvent).toBe(25);
  });
});

describe("SPX-0 — status transition stamps lastContactedAt", () => {
  const now = new Date("2026-08-28T16:00:00Z");

  it("stamps when moving into CONTACTED", () => {
    expect(lastContactedAtForStatusChange("TO_CONTACT", "CONTACTED", now)).toEqual(now);
    expect(lastContactedAtForStatusChange("IN_CONVERSATION", "CONTACTED", now)).toEqual(now);
  });

  it("does not restamp CONTACTED or other moves", () => {
    expect(lastContactedAtForStatusChange("CONTACTED", "CONTACTED", now)).toBeUndefined();
    expect(lastContactedAtForStatusChange("CONTACTED", "IN_CONVERSATION", now)).toBeUndefined();
    expect(lastContactedAtForStatusChange("TO_CONTACT", "CONFIRMED", now)).toBeUndefined();
  });
});

describe("SPX-0 — CSV dry-run (W-2 shape)", () => {
  it("suggests org / contact / email / website / notes columns", () => {
    const mapping = suggestOutreachCsvMapping([
      "Organization",
      "Contact name",
      "Email",
      "Website",
      "Notes",
      "Ignore me",
    ]);
    expect(mapping.Organization).toBe("org");
    expect(mapping["Contact name"]).toBe("contactName");
    expect(mapping.Email).toBe("email");
    expect(mapping.Website).toBe("website");
    expect(mapping.Notes).toBe("notes");
    expect(mapping["Ignore me"]).toBe("skip");
  });

  it("dedupes by orgName within the file and against the event", () => {
    const result = dryRunOutreachCsv({
      headers: ["org", "email"],
      rows: [
        { org: "Acme Labs", email: "a@acme.edu" },
        { org: "acme labs", email: "b@acme.edu" },
        { org: "Northbridge", email: "n@nb.edu" },
        { org: "Already Here", email: "x@x.edu" },
      ],
      existingOrgNames: ["Already Here"],
    });
    expect(result.summary.creates).toBe(2);
    expect(result.summary.errors).toBe(2);
    const errors = result.rows.filter((r) => r.kind === "error");
    expect(errors.some((r) => r.kind === "error" && r.message.includes("Duplicate in file"))).toBe(
      true,
    );
    expect(errors.some((r) => r.kind === "error" && r.message.includes("Already in this pipeline"))).toBe(
      true,
    );
  });

  it("requires an organization column and skips blank rows", () => {
    const noOrg = dryRunOutreachCsv({
      headers: ["email"],
      rows: [{ email: "a@x.edu" }],
    });
    expect(noOrg.rows[0]?.kind).toBe("error");
    expect(noOrg.rows[0]?.kind === "error" && noOrg.rows[0].message).toMatch(/organization/i);

    const blanks = dryRunOutreachCsv({
      headers: ["org", "email"],
      rows: [
        { org: "  ", email: "" },
        { org: "Kept", email: "" },
        { org: "", email: "" },
        { org: "", email: "orphan@x.edu" },
      ],
    });
    expect(blanks.summary.creates).toBe(1);
    expect(blanks.summary.skipped).toBe(2);
    expect(blanks.summary.errors).toBe(1);
  });

  it("flags invalid email and website; prefixes https for bare domains", () => {
    const result = dryRunOutreachCsv({
      headers: ["org", "email", "website"],
      rows: [
        { org: "Good", email: "ok@school.edu", website: "school.edu" },
        { org: "Bad mail", email: "not-an-email", website: "" },
        { org: "Bad web", email: "", website: "nota url" },
      ],
    });
    expect(result.summary.creates).toBe(1);
    expect(result.summary.errors).toBe(2);
    const create = result.rows.find((r) => r.kind === "create");
    expect(create?.kind === "create" && create.websiteUrl).toMatch(/^https:\/\/school\.edu/i);
  });
});

describe("SPX-0 — migration is additive", () => {
  const sql = readFileSync(
    resolve(__dirname, "../../prisma/migrations/20260828140000_spx0_sponsor_outreach/migration.sql"),
    "utf8",
  );

  it("creates the two new tables and a new enum only", () => {
    expect(sql).toMatch(/CREATE TYPE "SponsorProspectStatus"/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "SponsorProspect"/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "OutreachTemplate"/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS "SponsorProspect_eventId_status_idx"/);
    expect(sql).not.toMatch(/\bDROP\b/);
    expect(sql).not.toMatch(/\bRENAME\b/);
    expect(sql).not.toMatch(/ALTER TABLE "Event"/);
    expect(sql).not.toMatch(/ALTER TABLE "Sponsor"/);
    expect(sql).not.toMatch(/^\s*ALLOW_DESTRUCTIVE_DB/m);
  });
});

describe("SPX-1 — merge fields + mailto", () => {
  const values = {
    orgName: "Acme Labs",
    contactName: "Jordan Lee",
    eventName: "Northbridge",
    eventDates: "Sep 1–2",
    eventUrl: "https://ukedl.com/e/northbridge",
  };

  it("resolves known fields; missing contactName is empty; unknown stays literal", () => {
    expect(resolveOutreachMergeFields("Hi {contactName} at {orgName}", values)).toBe(
      "Hi Jordan Lee at Acme Labs",
    );
    expect(resolveOutreachMergeFields("Hello {contactName},", { ...values, contactName: undefined })).toBe(
      "Hello ,",
    );
    expect(resolveOutreachMergeFields("Keep {notAField} and {orgName}", values)).toBe(
      "Keep {notAField} and Acme Labs",
    );
    expect(resolveOutreachMergeFields(OUTREACH_STARTER_TEMPLATE.subject, values)).toContain("Acme Labs");
  });

  it("encodes newlines, ampersands, and non-ASCII org names in mailto", () => {
    const href = buildOutreachMailto({
      to: "pat@school.example",
      cc: "me@ukedl.com",
      subject: "Ask: München & Friends",
      body: "Line 1\nLine 2 & more\n株式会社北橋",
    });
    expect(href).toContain(`subject=${encodeURIComponent("Ask: München & Friends")}`);
    expect(href).toContain(`body=${encodeURIComponent("Line 1\nLine 2 & more\n株式会社北橋")}`);
    expect(href).toContain("%0A");
    expect(href).toContain("%26");
    expect(href).toContain(encodeURIComponent("株式会社北橋"));
  });
});

describe("SPX-1 — OUTREACH_DRAFT metering + gate", () => {
  beforeEach(() => {
    process.env.AI_PROVIDER = "mock";
    resetAiProviderForTests(new MockAiProvider());
  });

  it("draftOutreachEmail uses the OUTREACH_DRAFT meter kind", async () => {
    const src = readFileSync(resolve(__dirname, "../lib/ai/outreach/draft.ts"), "utf8");
    expect(src).toMatch(/feature:\s*"OUTREACH_DRAFT"/);
    expect(src).toMatch(/never send/i);

    const result = await draftOutreachEmail({
      organizationId: "org_test",
      eventId: "evt_test",
      userId: "user_test",
      skipCap: true,
      skipMetering: true,
      skipAudit: true,
      event: {
        name: "Northbridge Conference",
        slug: "northbridge",
        description: "A regional conference for school leaders.",
        timezone: "UTC",
        startDate: new Date("2027-09-01T09:00:00Z"),
        endDate: new Date("2027-09-02T17:00:00Z"),
        attendeeCap: 250,
        participantLabelsJson: '["Faculty"]',
      },
      prospect: {
        orgName: "Acme Labs",
        contactName: "Jordan Lee",
        contactEmail: "j@acme.edu",
        websiteUrl: "https://acme.edu",
        notes: null,
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.subject.length).toBeGreaterThan(0);
      expect(result.draft.body).toMatch(/Acme Labs|Northbridge/);
      expect(result.draft.aiGenerated).toBe(true);
      expect(result.draft.metered).toBe(false);
    }
  });

  it("event context includes name, dates, type, description, audience", () => {
    const ctx = outreachEventContext({
      name: "Northbridge Conference",
      slug: "northbridge",
      description: "A regional conference for school leaders.",
      timezone: "UTC",
      startDate: new Date("2027-09-01T09:00:00Z"),
      endDate: new Date("2027-09-02T17:00:00Z"),
      attendeeCap: 250,
      participantLabelsJson: '["Faculty"]',
    });
    expect(ctx.name).toBe("Northbridge Conference");
    expect(ctx.dates).toMatch(/2027/);
    expect(ctx.type.toLowerCase()).toMatch(/conference/);
    expect(ctx.description).toMatch(/school leaders/);
    expect(ctx.audience).toMatch(/250/);
    expect(ctx.audience).toMatch(/Faculty/);
    expect(ctx.url).toMatch(/\/e\/northbridge$/);
  });

  it("schema and route wire OUTREACH_DRAFT; templates/draft are feature-gated", () => {
    const schema = readFileSync(resolve(__dirname, "../../prisma/schema.prisma"), "utf8");
    expect(schema).toMatch(/OUTREACH_DRAFT/);
    const routes = readFileSync(resolve(__dirname, "../routes/outreach.ts"), "utf8");
    expect(routes).toMatch(/\/templates/);
    expect(routes).toMatch(/\/prospects\/:prospectId\/draft/);
    expect(routes).toMatch(/AUTHENTICATED_AI_CHAT_LIMIT/);
    expect(routes).toMatch(/requireOutreach/);
    expect(routes).toMatch(/draftOutreachEmail/);
    expect(routes).not.toMatch(/resend/i);
    const caps = readFileSync(resolve(__dirname, "../lib/ai/caps.ts"), "utf8");
    expect(caps).not.toMatch(/OUTREACH_DRAFT/);
  });

  it("ADD VALUE isolation for OUTREACH_DRAFT", () => {
    const sql = readFileSync(
      resolve(__dirname, "../../prisma/migrations/20260828210000_spx1_outreach_draft/migration.sql"),
      "utf8",
    );
    expect(sql).toMatch(/ALTER TYPE "AiMeterFeature" ADD VALUE IF NOT EXISTS 'OUTREACH_DRAFT'/);
    expect(sql.replace(/--.*$/gm, "")).not.toMatch(/INSERT|UPDATE|CREATE TABLE|DROP|RENAME/i);
    expect(sql).not.toMatch(/^\s*ALLOW_DESTRUCTIVE_DB/m);
  });
});
