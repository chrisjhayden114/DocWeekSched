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
      // Brand sits in the trailing segment ("— Readyhall" or "— Readyhall conference software").
      const tail = page.title.slice(page.title.lastIndexOf("—") + 1);
      expect(tail).toContain(brand.productName);
    }
  });

  it("the homepage title is the category-first seoTitle", () => {
    expect(marketingSeo.pages.home.title).toBe(marketingSeo.seoTitle);
    expect(marketingSeo.seoTitle.toLowerCase()).toContain("conference and pd day software");
  });

  it("descriptions stay within search-snippet length", () => {
    for (const [, page] of PAGES) {
      expect(page.description.length).toBeLessThanOrEqual(170);
    }
  });

  it("categoryLine names the category plainly", () => {
    expect(marketingSeo.categoryLine).toBe("Calm event software for conferences and PD days in education.");
    expect(marketingSeo.categoryLine.startsWith(brand.productName)).toBe(false);
  });

  it("help article titles lead with the article topic, brand last", () => {
    const title = marketingArticleTitle("Import a program from a spreadsheet");
    expect(title.startsWith("Import a program from a spreadsheet")).toBe(true);
    expect(title.endsWith(`${brand.productName} conference software`)).toBe(true);
  });
});

describe("comparison pages (E27) — the two 'alternative' queries", () => {
  // Uniqueness, description budget, and brand-last are already enforced by the
  // loops above (compare pages live in marketingSeo.pages). These pin the
  // query-first shape specific to the comparison pages.
  const cases = [
    { page: marketingSeo.pages.compareSched, competitor: "Sched" },
    { page: marketingSeo.pages.compareWhova, competitor: "Whova" },
  ] as const;

  it("titles lead with the '<Competitor> alternative' query and end brand-vs-competitor", () => {
    for (const { page, competitor } of cases) {
      expect(page.title.startsWith(`${competitor} alternative`)).toBe(true);
      expect(page.title.endsWith(`${brand.productName} vs ${competitor}`)).toBe(true);
    }
  });

  it("descriptions lead with the category query, within the snippet budget", () => {
    for (const { page, competitor } of cases) {
      expect(page.description.startsWith(`${competitor} alternative for conferences and PD days`)).toBe(true);
      expect(page.description.length).toBeLessThanOrEqual(170);
    }
  });
});

describe("speakerReadiness page (MKT-2) — buyer-search title", () => {
  it("leads with speaker management / content collection and ends with the feature + brand", () => {
    expect(marketingSeo.pages.speakerReadiness.title).toBe(
      `Speaker management and content collection for conferences and PD days — Speaker Readiness — ${brand.productName}`,
    );
    expect(marketingSeo.pages.speakerReadiness.description.toLowerCase()).toContain("speaker management");
    expect(marketingSeo.pages.speakerReadiness.description.toLowerCase()).toContain("content collection");
  });
});
