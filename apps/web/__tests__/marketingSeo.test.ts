import { describe, expect, it } from "vitest";
import { brand, marketingArticleTitle, marketingSeo } from "@event-app/config";

const PAGES = Object.entries(marketingSeo.pages) as [string, { title: string; description: string }][];

describe("marketingSeo (E25) — search-facing titles and descriptions", () => {
  it("every marketing page has a unique title", () => {
    const titles = PAGES.map(([, p]) => p.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("every marketing page has a unique, non-empty description", () => {
    const descriptions = PAGES.map(([, p]) => p.description);
    expect(new Set(descriptions).size).toBe(descriptions.length);
    for (const d of descriptions) expect(d.trim().length).toBeGreaterThan(0);
  });

  it("titles put category words first and the brand last — never brand-first", () => {
    for (const [, page] of PAGES) {
      expect(page.title.startsWith(brand.productName)).toBe(false);
      expect(page.title.includes(brand.productName)).toBe(true);
      // Brand sits in the trailing segment ("— UKEDL" or "— UKEDL conference software").
      const tail = page.title.slice(page.title.lastIndexOf("—") + 1);
      expect(tail).toContain(brand.productName);
    }
  });

  it("the homepage title is the category-first seoTitle", () => {
    expect(marketingSeo.pages.home.title).toBe(marketingSeo.seoTitle);
    expect(marketingSeo.seoTitle.toLowerCase()).toContain("conference schedule software");
  });

  it("descriptions stay within search-snippet length", () => {
    for (const [, page] of PAGES) {
      expect(page.description.length).toBeLessThanOrEqual(170);
    }
  });

  it("categoryLine names the category plainly", () => {
    expect(marketingSeo.categoryLine.toLowerCase()).toContain("academic conferences");
    expect(marketingSeo.categoryLine.startsWith(brand.productName)).toBe(false);
  });

  it("help article titles lead with the article topic, brand last", () => {
    const title = marketingArticleTitle("Import a program from a spreadsheet");
    expect(title.startsWith("Import a program from a spreadsheet")).toBe(true);
    expect(title.endsWith(`${brand.productName} conference software`)).toBe(true);
  });
});
