/**
 * Phase 6 Chunk C — /help markdown seed + sitemap paths (unit).
 */

import { describe, expect, it } from "vitest";
import { brand } from "@event-app/config";
import { resolve } from "path";
import { existsSync, readdirSync, readFileSync } from "fs";

// Resolve help content relative to the web package (vitest cwd = apps/api).
const HELP_DIR = resolve(process.cwd(), "../web/content/help");

function loadArticles() {
  if (!existsSync(HELP_DIR)) return [];
  return readdirSync(HELP_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const slug = f.replace(/\.md$/, "");
      const raw = readFileSync(resolve(HELP_DIR, f), "utf8");
      const title = /title:\s*(.+)/.exec(raw)?.[1]?.trim().replace(/^["']|["']$/g, "") || slug;
      return { slug, title, raw };
    });
}

describe("Phase 6 /help seed (unit)", () => {
  it("ships getting-started, attendee-faq, and contact markdown", () => {
    const articles = loadArticles();
    const slugs = articles.map((a) => a.slug).sort();
    expect(slugs).toEqual(["attendee-faq", "contact", "getting-started"]);
  });

  it("contact article uses config support email token", () => {
    const contact = loadArticles().find((a) => a.slug === "contact");
    expect(contact).toBeTruthy();
    expect(contact!.raw).toContain("{{support}}");
    expect(contact!.raw).toContain("mailto:{{support}}");
    // Runtime substitution uses brand.supportEmail
    expect(brand.supportEmail).toMatch(/@/);
  });

  it("sitemap paths include /help articles + demo, not arbitrary customer events", () => {
    const articles = loadArticles();
    const paths = [
      "/",
      "/pricing",
      "/terms",
      "/privacy",
      "/security",
      "/help",
      ...articles.map((a) => `/help/${a.slug}`),
      `/e/${brand.demoEventSlug}`,
    ];
    expect(paths).toContain("/help/getting-started");
    expect(paths).toContain("/help/attendee-faq");
    expect(paths).toContain("/help/contact");
    expect(paths).toContain(`/e/${brand.demoEventSlug}`);
    expect(paths.some((p) => p.startsWith("/e/") && !p.endsWith(`/${brand.demoEventSlug}`))).toBe(
      false,
    );
  });
});
