/**
 * SHOT-CI — the generated auto-shot index and the resolver that reads it.
 *
 * The index is a committed directory listing, so the failure mode worth
 * catching is drift: images added or removed without rerunning
 * `npm run gen:auto-shots`, which would either serve a 404 into a hover card or
 * hide a screenshot that is sitting right there.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FEATURE_BY_KEY, FEATURE_GUIDE, type FeatureKey } from "@event-app/shared";
import { FEATURE_GUIDE_AUTO_KEYS } from "../lib/featureGuideAuto";
import {
  AUTO_SHOT_URL_PREFIX,
  autoScreenshotSrc,
  featureGuideImage,
  featureGuideImageSources,
  hasAutoScreenshot,
} from "../lib/featureGuideImage";
import { eligibleScreenshotKeys } from "../screenshot-manifest";

const AUTO_DIR = join(__dirname, "..", "public", "feature-guide", "auto");

function committedAutoKeys(): string[] {
  if (!existsSync(AUTO_DIR)) return [];
  return readdirSync(AUTO_DIR)
    .filter((f) => f.endsWith(".png"))
    .map((f) => f.replace(/\.png$/, ""))
    .sort();
}

describe("lib/featureGuideAuto.ts (generated)", () => {
  it("matches public/feature-guide/auto — rerun npm run gen:auto-shots if this fails", () => {
    expect([...FEATURE_GUIDE_AUTO_KEYS].sort()).toEqual(committedAutoKeys());
  });

  it("lists only feature keys the manifest is allowed to capture", () => {
    const eligible = eligibleScreenshotKeys();
    for (const key of FEATURE_GUIDE_AUTO_KEYS) {
      expect(FEATURE_BY_KEY[key], `${key} is not a feature key`).toBeDefined();
      expect(eligible, `${key} is retired or planned and should not have a shot`).toContain(key);
    }
  });
});

describe("featureGuideImage resolution order", () => {
  it("prefers the founder's manual shot over anything generated", () => {
    // Community plus MANUAL-1: founder-approved paths sit in /feature-guide/,
    // never /feature-guide/auto/.
    for (const key of [
      "community",
      "community_meetups",
      "community_moments",
      "concierge",
      "cfp",
      "readiness",
      "engagement_points",
      "certificates",
      "venue_maps",
      "session_feedback",
      "sponsors",
      "sponsor_outreach",
      "checkin",
    ] as const) {
      const manual = FEATURE_GUIDE[key].imageSrc!;
      expect(featureGuideImage(key)).toBe(manual);
      expect(manual.startsWith(`${AUTO_SHOT_URL_PREFIX}/`)).toBe(false);
    }
  });

  it("falls back to the auto shot when one is committed, then to nothing", async () => {
    vi.resetModules();
    vi.doMock("../lib/featureGuideAuto", () => ({
      FEATURE_GUIDE_AUTO_KEYS: ["session_polls", "community"] as FeatureKey[],
    }));
    const mocked = await import("../lib/featureGuideImage");
    try {
      // No manual art for polls → the generated file wins.
      expect(mocked.featureGuideImage("session_polls")).toBe("/feature-guide/auto/session_polls.png");
      // Manual art exists for community → the generated file is ignored.
      expect(mocked.featureGuideImage("community")).toBe(FEATURE_GUIDE.community.imageSrc);
      // Neither → callers render <FeatureArt category>.
      expect(mocked.featureGuideImage("ops_agent")).toBeUndefined();
      expect(mocked.hasAutoScreenshot("session_polls")).toBe(true);
      expect(mocked.hasAutoScreenshot("ops_agent")).toBe(false);
    } finally {
      vi.doUnmock("../lib/featureGuideAuto");
      vi.resetModules();
    }
  });

  it("derives the auto URL from the feature key alone", () => {
    expect(autoScreenshotSrc("sponsor_outreach")).toBe("/feature-guide/auto/sponsor_outreach.png");
    expect(AUTO_SHOT_URL_PREFIX).toBe("/feature-guide/auto");
  });

  it("returns a deduped prefetch list covering exactly the resolvable keys", () => {
    const srcs = featureGuideImageSources();
    expect(new Set(srcs).size).toBe(srcs.length);
    const resolvable = (Object.keys(FEATURE_GUIDE) as FeatureKey[]).filter((k) => featureGuideImage(k));
    expect(srcs).toHaveLength(new Set(resolvable.map((k) => featureGuideImage(k))).size);
    for (const key of resolvable) {
      expect(srcs).toContain(featureGuideImage(key));
    }
  });

  it("reports no auto shot for keys with nothing committed", () => {
    for (const key of FEATURE_GUIDE_AUTO_KEYS) {
      expect(hasAutoScreenshot(key)).toBe(true);
    }
    if (!FEATURE_GUIDE_AUTO_KEYS.includes("ops_agent")) {
      expect(hasAutoScreenshot("ops_agent")).toBe(false);
    }
  });
});
