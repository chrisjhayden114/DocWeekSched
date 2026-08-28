/**
 * K-2.1 — every registry key has a full guide, and whatItDoes is not a
 * restatement of the Features-tab one-liner.
 */

import { describe, expect, it } from "vitest";
import { FEATURE_BY_KEY, FEATURE_GUIDE, FEATURE_REGISTRY, type FeatureKey } from "@event-app/shared";

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
    for (const key of KEYS) {
      const guide = FEATURE_GUIDE[key];
      for (const [name, text] of Object.entries(guide)) {
        const count = sentences(text).length;
        expect(count, `${key}.${name} (${count}): ${text}`).toBeGreaterThanOrEqual(2);
        expect(count, `${key}.${name} (${count}): ${text}`).toBeLessThanOrEqual(4);
      }
    }
  });
});
