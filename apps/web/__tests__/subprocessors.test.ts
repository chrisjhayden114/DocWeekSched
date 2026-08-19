import { describe, expect, it } from "vitest";
import { brand } from "@event-app/config";

/** Same line the privacy policy renders for each row. */
function renderSubprocessor(s: (typeof brand.subprocessors)[number]): string {
  return `${s.name} — ${s.role} (region: ${s.region})`;
}

const byName = Object.fromEntries(brand.subprocessors.map((s) => [s.name, s]));

const DASHBOARD_VERIFIED: Record<string, string> = {
  Neon: "AWS us-east-1 (N. Virginia, USA)",
  Render: "Virginia (US East), USA",
  Cloudflare: "Western North America (WNAM)",
  Netlify: "Global CDN, US-based provider",
};

const US_BASED_ONLY = ["Resend", "Stripe", "Anthropic", "Sentry", "Better Stack"] as const;

describe("brand.subprocessors (privacy rendering)", () => {
  it("renders every row with a real region — never the dashboard placeholder", () => {
    expect(brand.subprocessors.length).toBeGreaterThan(0);
    for (const row of brand.subprocessors) {
      const line = renderSubprocessor(row);
      expect(row.region.trim().length).toBeGreaterThan(0);
      expect(row.region).not.toMatch(/see dashboard/i);
      expect(line).toContain(`(region: ${row.region})`);
    }
  });

  it("uses the founder-read dashboard regions for hosted infrastructure", () => {
    for (const [name, region] of Object.entries(DASHBOARD_VERIFIED)) {
      expect(byName[name]?.region).toBe(region);
    }
  });

  it("labels remaining providers as United States–based only — no invented region", () => {
    for (const name of US_BASED_ONLY) {
      expect(byName[name]?.region).toBe("United States–based provider");
    }
  });

  it("names Anthropic's role without calling Event assistant traffic organizer-initiated", () => {
    expect(byName.Anthropic?.role).toBe(
      "AI processing for event assistant conversations and organizer AI features (drafts and answers; disclosed in-product)",
    );
  });
});
