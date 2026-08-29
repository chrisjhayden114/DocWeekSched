/**
 * SPX-0 — sponsor outreach pipeline (pure). UKEDL never sends these emails.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  dryRunOutreachCsv,
  lastContactedAtForStatusChange,
  PLAN_BY_SKU,
  suggestOutreachCsvMapping,
} from "@event-app/shared";
import { FEATURE_BY_KEY } from "../lib/features/registry";

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
    expect(PLAN_BY_SKU.free.entitlements.sponsor_outreach).toBe(false);
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
