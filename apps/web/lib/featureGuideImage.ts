/**
 * SHOT-CI — one resolver for "which picture belongs to this feature".
 *
 * Order, highest wins:
 *   1. FEATURE_GUIDE[key].imageSrc — founder-approved manuals (Community plus
 *      MANUAL-1). A manual shot always beats a generated one; the capture
 *      workflow never edits featureGuide.ts, so this stays true by construction.
 *   2. /feature-guide/auto/<key>.png, when that file is committed. Presence is
 *      compiled in via lib/featureGuideAuto.ts (a directory listing cannot be
 *      read at render time).
 *   3. Nothing — callers fall back to <FeatureArt category> line art.
 */

import { FEATURE_GUIDE, type FeatureKey } from "@event-app/shared";
import { FEATURE_GUIDE_AUTO_KEYS } from "./featureGuideAuto";

export const AUTO_SHOT_URL_PREFIX = "/feature-guide/auto";

const autoKeys = new Set<FeatureKey>(FEATURE_GUIDE_AUTO_KEYS);

export function autoScreenshotSrc(key: FeatureKey): string {
  return `${AUTO_SHOT_URL_PREFIX}/${key}.png`;
}

export function hasAutoScreenshot(key: FeatureKey): boolean {
  return autoKeys.has(key);
}

/** The screenshot for a feature card, or undefined when only art is available. */
export function featureGuideImage(key: FeatureKey): string | undefined {
  const manual = FEATURE_GUIDE[key]?.imageSrc;
  if (manual) return manual;
  return autoKeys.has(key) ? autoScreenshotSrc(key) : undefined;
}

/** Every resolved screenshot URL, deduped — used to prefetch the hover cards. */
export function featureGuideImageSources(): string[] {
  const srcs = new Set<string>();
  for (const key of Object.keys(FEATURE_GUIDE) as FeatureKey[]) {
    const src = featureGuideImage(key);
    if (src) srcs.add(src);
  }
  return [...srcs];
}
