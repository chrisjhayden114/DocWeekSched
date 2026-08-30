/**
 * E1.3 — /help renders from the bundled HELP_SOURCE module (runtime fs reads
 * of content/help/*.md return nothing in the serverless bundle). The .md files
 * stay the human-editable source; this test fails if the two drift.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { brand } from "@event-app/config";
import { applyBrandTokens, listHelpArticles } from "../lib/help/articles";
import { HELP_SOURCE } from "../lib/help/helpContent";

const CONTENT_DIR = join(__dirname, "../content/help");

describe("bundled help content matches content/help/*.md", () => {
  const files = readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".md"));

  it("covers exactly the markdown files on disk", () => {
    const diskSlugs = files.map((f) => f.replace(/\.md$/, "")).sort();
    expect(Object.keys(HELP_SOURCE).sort()).toEqual(diskSlugs);
  });

  for (const file of files) {
    const slug = file.replace(/\.md$/, "");
    it(`"${slug}" is byte-identical to its markdown file`, () => {
      const disk = readFileSync(join(CONTENT_DIR, file), "utf8");
      expect(HELP_SOURCE[slug]).toBe(disk);
    });
  }
});

describe("HELP-2 — help index brand tokens", () => {
  it("substitutes {{product}} in article descriptions the same way /help/[slug] does", () => {
    const outreach = listHelpArticles().find((a) => a.slug === "send-sponsor-outreach");
    expect(outreach).toBeDefined();
    expect(outreach!.description).toContain("{{product}}");
    expect(applyBrandTokens(outreach!.description)).toContain(brand.productName);
    expect(applyBrandTokens(outreach!.description)).not.toContain("{{product}}");
  });

  it("the help index page applies applyBrandTokens to descriptions", () => {
    const src = readFileSync(join(__dirname, "../pages/help/index.tsx"), "utf8");
    expect(src).toContain("applyBrandTokens");
    expect(src).toContain("description: applyBrandTokens(a.description)");
  });
});
