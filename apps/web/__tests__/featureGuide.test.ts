/**
 * K-2.1 — every registry key has a full guide, and whatItDoes is not a
 * restatement of the Features-tab one-liner.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { brand } from "@event-app/config";
import { FEATURE_BY_KEY, FEATURE_GUIDE, FEATURE_REGISTRY, featureGuideGroups, featureGuideImageSrcs, type FeatureKey } from "@event-app/shared";
import { applyBrandTokens } from "../lib/brandTokens";
import { featureGuideImage } from "../lib/featureGuideImage";
import { pngSize } from "../screenshot-frame";

const KEYS = FEATURE_REGISTRY.map((f) => f.key);

function sentences(text: string): string[] {
  return text
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

describe("K-2.1 — Feature Guide completeness", () => {
  it("has an entry for every FeatureKey with all three sections", () => {
    expect(Object.keys(FEATURE_GUIDE).sort()).toEqual([...KEYS].sort());
    for (const key of KEYS) {
      const guide = FEATURE_GUIDE[key];
      expect(guide.whatItDoes.trim(), `${key}.whatItDoes`).not.toBe("");
      expect(guide.experience.trim(), `${key}.experience`).not.toBe("");
      expect(guide.goodToKnow.trim(), `${key}.goodToKnow`).not.toBe("");
    }
  });

  it("whatItDoes is deeper than plainDescription (not a duplicate)", () => {
    for (const key of KEYS) {
      const def = FEATURE_BY_KEY[key as FeatureKey];
      const what = FEATURE_GUIDE[key].whatItDoes.trim();
      expect(what, key).not.toBe(def.plainDescription.trim());
      expect(what.toLowerCase(), key).not.toBe(def.plainDescription.trim().toLowerCase());
    }
  });

  it("each section is 2–4 sentences", () => {
    const sections = ["whatItDoes", "experience", "goodToKnow"] as const;
    for (const key of KEYS) {
      const guide = FEATURE_GUIDE[key];
      for (const name of sections) {
        const text = guide[name];
        const count = sentences(text).length;
        expect(count, `${key}.${name} (${count}): ${text}`).toBeGreaterThanOrEqual(2);
        expect(count, `${key}.${name} (${count}): ${text}`).toBeLessThanOrEqual(4);
      }
      if (guide.imageSrc != null) {
        expect(guide.imageSrc.trim(), `${key}.imageSrc`).not.toBe("");
      }
    }
  });

  // SITE-COPY-2 #9 — /help/feature-guide renders these screenshots as content,
  // not decoration, so every one a reader can reach has to describe itself.
  it("every screenshot the page renders carries alt text", () => {
    for (const key of KEYS) {
      const hasImage = featureGuideImage(key) != null;
      const alt = FEATURE_GUIDE[key].imageAlt;
      if (!hasImage) {
        expect(alt, `${key} renders no screenshot, so alt text would describe nothing`).toBeUndefined();
        continue;
      }
      expect(alt?.trim(), `${key}.imageAlt`).toBeTruthy();
      // Alt that only repeats the feature name tells a screen reader nothing.
      expect(alt?.trim().toLowerCase(), `${key}.imageAlt`).not.toBe(
        FEATURE_BY_KEY[key as FeatureKey].name.toLowerCase(),
      );
    }
  });

  it("K-6 / MANUAL-1: founder-supplied screenshots are wired on imageSrc", () => {
    expect(FEATURE_GUIDE.community.imageSrc).toBe("/feature-guide/community.png");
    expect(FEATURE_GUIDE.community_meetups.imageSrc).toBe("/feature-guide/community_meetups.png");
    expect(FEATURE_GUIDE.community_moments.imageSrc).toBe("/feature-guide/community_moments.jpg");
    expect(FEATURE_GUIDE.community_local.imageSrc).toBe("/feature-guide/community_local.png");
    expect(FEATURE_GUIDE.community_icebreakers.imageSrc).toBe("/feature-guide/community_icebreakers.png");
    expect(FEATURE_GUIDE.community_general.imageSrc).toBe("/feature-guide/community_general.png");
    expect(FEATURE_GUIDE.engagement_points.imageSrc).toBe("/feature-guide/engagement_points.png");
    expect(FEATURE_GUIDE.concierge.imageSrc).toBe("/feature-guide/concierge.png");
    const conciergePng = join(__dirname, "../public/feature-guide/concierge.png");
    expect(existsSync(conciergePng), "concierge.png must stay at the wired filename").toBe(true);
    const conciergeSize = pngSize(readFileSync(conciergePng));
    expect(conciergeSize.width).toBeGreaterThan(0);
    expect(conciergeSize.height).toBeGreaterThan(0);
    expect(FEATURE_GUIDE.venue_maps.imageSrc).toBe("/feature-guide/venue_maps.png");
    expect(FEATURE_GUIDE.cfp.imageSrc).toBe("/feature-guide/cfp.png");
    expect(FEATURE_GUIDE.sponsors.imageSrc).toBe("/feature-guide/sponsors.png");
    expect(FEATURE_GUIDE.sponsor_outreach.imageSrc).toBe("/feature-guide/sponsor_outreach.png");
    expect(FEATURE_GUIDE.checkin.imageSrc).toBe("/feature-guide/checkin.png");
    expect(FEATURE_GUIDE.certificates.imageSrc).toBe("/feature-guide/certificates.png");
    expect(FEATURE_GUIDE.readiness.imageSrc).toBe("/feature-guide/readiness.png");
    expect(FEATURE_GUIDE.public_leaderboard.imageSrc).toBeUndefined();
    expect(featureGuideImageSrcs()).toEqual([
      "/feature-guide/community.png",
      "/feature-guide/community_meetups.png",
      "/feature-guide/community_moments.jpg",
      "/feature-guide/community_local.png",
      "/feature-guide/community_icebreakers.png",
      "/feature-guide/community_general.png",
      "/feature-guide/engagement_points.png",
      "/feature-guide/concierge.png",
      "/feature-guide/venue_maps.png",
      "/feature-guide/cfp.png",
      "/feature-guide/sponsors.png",
      "/feature-guide/sponsor_outreach.png",
      "/feature-guide/checkin.png",
      "/feature-guide/certificates.png",
      "/feature-guide/readiness.png",
    ]);
  });

  it("HELP-2 — /help/feature-guide groups omit retired keys instead of a tombstone", () => {
    const keys = featureGuideGroups().flatMap((g) => g.keys);
    expect(keys).not.toContain("messaging_event_chat");
    expect(FEATURE_BY_KEY.messaging_event_chat.retired).toBe(true);
    expect(FEATURE_GUIDE.messaging_event_chat.whatItDoes).toMatch(/retired/i);
  });

  it("HELP-2.1 — packages/shared has no import from @event-app/config", () => {
    const srcDir = join(__dirname, "../../../packages/shared/src");
    const files = readdirSync(srcDir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const src = readFileSync(join(srcDir, file), "utf8");
      expect(src, file).not.toMatch(/from\s+["']@event-app\/config["']/);
      expect(src, file).not.toMatch(/require\(\s*["']@event-app\/config["']\s*\)/);
    }
  });

  it("HELP-2.1 — Feature Guide copy uses {{product}}; applyBrandTokens substitutes it", () => {
    expect(FEATURE_GUIDE.sponsor_outreach.whatItDoes).toContain("{{product}}");
    expect(FEATURE_GUIDE.sponsor_outreach.goodToKnow).toContain("{{product}}");
    expect(applyBrandTokens(FEATURE_GUIDE.sponsor_outreach.whatItDoes)).toContain(brand.productName);
    expect(applyBrandTokens(FEATURE_GUIDE.sponsor_outreach.whatItDoes)).not.toContain("{{product}}");
    expect(applyBrandTokens(FEATURE_GUIDE.sponsor_outreach.goodToKnow)).toContain(brand.productName);
    expect(applyBrandTokens(FEATURE_GUIDE.sponsor_outreach.goodToKnow)).not.toContain("{{product}}");
  });
});
