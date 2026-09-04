/**
 * BRAND-R1 / BRAND-R2 — the retired brand name must not reach a user.
 *
 * A rename is the failure mode where a grep looks clean and the old name is
 * still live in the one file nobody re-reads. This scans every surface a person
 * can actually see — marketing and app pages, components, the help corpus — for
 * the retired name and the retired domain, and separately pins the brand config
 * fields that carry a name into copy.
 *
 * The legal operator is the LLC. The retired name must not appear there, or
 * on any other user-visible surface. Third-party hosts (the Better Stack
 * status page) still rename in a provider dashboard, not in this repo.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { brand, brandTransition, marketingSeo } from "@event-app/config";

const WEB_ROOT = resolve(__dirname, "..");
const RETIRED = /ukedl/i;

/**
 * Strings that may never be rendered. The retired brand, plus the TED
 * trademark — the in-product and marketing name is "talk showcase"
 * (DESIGN_PHASE_J.md). The one sanctioned descriptive use is the setup
 * copilot's licence fact, which lives in packages/shared, outside this scan.
 */
const FORBIDDEN_VISIBLE = /ukedl|tedx/i;

/** Sentry issue ids from before the rename — a reference to a report, not a name. */
const SENTRY_ISSUE_ID = /UKEDL-[A-Z]+-\d+/;

const SCANNED_DIRS = ["pages", "components", "content", "lib/help"] as const;
const SCANNED_EXTENSIONS = [".ts", ".tsx", ".md", ".css"] as const;

type Hit = { file: string; line: number; text: string };

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (SCANNED_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

function scanForRetiredBrand(): Hit[] {
  const hits: Hit[] = [];
  for (const dir of SCANNED_DIRS) {
    for (const file of walk(resolve(WEB_ROOT, dir))) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((text, index) => {
        if (!FORBIDDEN_VISIBLE.test(text)) return;
        if (SENTRY_ISSUE_ID.test(text)) return;
        hits.push({ file: relative(WEB_ROOT, file), line: index + 1, text: text.trim() });
      });
    }
  }
  return hits;
}

describe("BRAND-R1 — no retired brand on a user-visible surface", () => {
  it("pages, components, and help content never say the retired name, domain, or TEDx", () => {
    const hits = scanForRetiredBrand();
    const report = hits.map((h) => `${h.file}:${h.line} — ${h.text}`).join("\n");
    expect(hits, `forbidden string still rendered:\n${report}`).toEqual([]);
  });

  it("the product name and every host derived from it are the new brand", () => {
    expect(brand.productName).toBe("Readyhall");
    expect(brand.domain).not.toMatch(RETIRED);
    expect(brand.primaryUrl).not.toMatch(RETIRED);
    expect(brand.supportEmail).not.toMatch(RETIRED);
    expect(brand.internalOrgName).toBe("Readyhall");
    expect(brand.internalOrgName).not.toMatch(RETIRED);
    expect(brand.primaryUrl).toContain(brand.domain);
    expect(brand.supportEmail).toContain(brand.domain);
  });

  it("every marketing title and description carries the new name and not the old", () => {
    for (const [name, page] of Object.entries(marketingSeo.pages)) {
      expect(page.title, name).toContain(brand.productName);
      expect(page.title, name).not.toMatch(RETIRED);
      expect(page.description, name).not.toMatch(RETIRED);
    }
    expect(marketingSeo.categoryLine).not.toMatch(RETIRED);
    expect(brand.shortTagline).not.toMatch(RETIRED);
  });

  it("the legal entity names the LLC and never the retired brand", () => {
    expect(brand.legalEntity).toBe("iQuest Learning Solutions LLC");
    expect(brand.legalEntity).not.toMatch(RETIRED);
    expect(brand.legalEntity).not.toMatch(/sole proprietorship|entity formation pending/i);
  });

  it("the only retired host left is the status page, and it is overridable", () => {
    // Printed as visible text on /security, so it may only move once the
    // subdomain has actually been renamed in Better Stack.
    if (RETIRED.test(brand.statusPageUrl)) {
      expect(brand.statusPageUrl).toContain("betteruptime.com");
    }
  });

  it("the transition allowlists still carry the retired origins — redirects need them", () => {
    expect(brandTransition.legacyWebDomains.join(" ")).toMatch(RETIRED);
    expect(brandTransition.extraApiOrigins.join(" ")).toMatch(RETIRED);
  });
});
