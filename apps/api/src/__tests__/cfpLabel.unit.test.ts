import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { cfpDisplayLabel, DEFAULT_CFP_LABEL } from "@event-app/shared";

describe("cfpDisplayLabel", () => {
  it("defaults to Call for Presentations when the label is missing or blank", () => {
    expect(DEFAULT_CFP_LABEL).toBe("Call for Presentations");
    expect(cfpDisplayLabel({})).toBe("Call for Presentations");
    expect(cfpDisplayLabel({ cfpLabel: null })).toBe("Call for Presentations");
    expect(cfpDisplayLabel({ cfpLabel: "" })).toBe("Call for Presentations");
    expect(cfpDisplayLabel({ cfpLabel: "   " })).toBe("Call for Presentations");
    expect(cfpDisplayLabel(null)).toBe("Call for Presentations");
    expect(cfpDisplayLabel(undefined)).toBe("Call for Presentations");
  });

  it("returns a custom label when set", () => {
    expect(cfpDisplayLabel({ cfpLabel: "Call for Papers" })).toBe("Call for Papers");
    expect(cfpDisplayLabel({ cfpLabel: "  Workshops  " })).toBe("Workshops");
  });
});

describe("K-2 — Event.cfpLabel migration shape", () => {
  const sql = readFileSync(
    resolve(__dirname, "../../prisma/migrations/20260827120000_k2_cfp_label/migration.sql"),
    "utf8",
  );

  it("adds a nullable VARCHAR(60) and is additive only", () => {
    expect(sql).toMatch(/ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "cfpLabel" VARCHAR\(60\)/);
    expect(sql).not.toMatch(/\bDROP\b/);
    expect(sql).not.toMatch(/\bRENAME\b/);
    expect(sql).not.toMatch(/SET NOT NULL/);
    expect(sql).not.toMatch(/^\s*ALLOW_DESTRUCTIVE_DB/m);
  });
});
