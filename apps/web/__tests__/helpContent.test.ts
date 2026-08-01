/**
 * E1.3 — /help renders from the bundled HELP_SOURCE module (runtime fs reads
 * of content/help/*.md return nothing in the serverless bundle). The .md files
 * stay the human-editable source; this test fails if the two drift.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
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
