/**
 * K-2.1 — every registry key has a full guide, and whatItDoes is not a
 * restatement of the Features-tab one-liner.
 */

import { describe, expect, it } from "vitest";
import { FEATURE_BY_KEY, FEATURE_GUIDE, FEATURE_REGISTRY, featureGuideGroups, featureGuideImageSrcs, type FeatureKey } from "@event-app/shared";

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

  it("K-6: founder-supplied community screenshots are wired, including icebreakers", () => {
    expect(FEATURE_GUIDE.community.imageSrc).toBe("/feature-guide/community.png");
    expect(FEATURE_GUIDE.community_meetups.imageSrc).toBe("/feature-guide/community_meetups.png");
    expect(FEATURE_GUIDE.community_moments.imageSrc).toBe("/feature-guide/community_moments.jpg");
    expect(FEATURE_GUIDE.community_local.imageSrc).toBe("/feature-guide/community_local.png");
    expect(FEATURE_GUIDE.community_icebreakers.imageSrc).toBe("/feature-guide/community_icebreakers.png");
    expect(FEATURE_GUIDE.community_general.imageSrc).toBe("/feature-guide/community_general.png");
    expect(featureGuideImageSrcs()).toEqual([
      "/feature-guide/community.png",
      "/feature-guide/community_meetups.png",
      "/feature-guide/community_moments.jpg",
      "/feature-guide/community_local.png",
      "/feature-guide/community_icebreakers.png",
      "/feature-guide/community_general.png",
    ]);
  });

  it("HELP-2 — /help/feature-guide groups omit retired keys instead of a tombstone", () => {
    const keys = featureGuideGroups().flatMap((g) => g.keys);
    expect(keys).not.toContain("messaging_event_chat");
    expect(FEATURE_BY_KEY.messaging_event_chat.retired).toBe(true);
    expect(FEATURE_GUIDE.messaging_event_chat.whatItDoes).toMatch(/retired/i);
  });
});
