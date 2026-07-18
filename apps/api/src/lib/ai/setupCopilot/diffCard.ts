/**
 * Build a reviewable CONFIG DIFF CARD from current → proposed overrides.
 */

import {
  FEATURE_BY_KEY,
  FEATURE_REGISTRY,
  applyPreset,
  normalizeOverridesForSave,
  type FeatureKey,
  type FeatureOverrideValue,
  type FeaturePresetId,
  LIVE_FEATURE_IMPACT,
  type ConfigDiffCard,
  type ConfigDiffEntry,
} from "@event-app/shared";
import { assertRegistryKeys } from "./keys";

type FeatureOverrides = Partial<Record<FeatureKey, FeatureOverrideValue>>;

function displayValue(
  key: FeatureKey,
  overrides: FeatureOverrides,
): FeatureOverrideValue {
  const v = overrides[key];
  if (v !== undefined) return v;
  return FEATURE_BY_KEY[key].defaultValue ?? FEATURE_BY_KEY[key].defaultOn;
}

function valuesEqual(a: FeatureOverrideValue, b: FeatureOverrideValue): boolean {
  return a === b;
}

export function buildConfigDiffCard(opts: {
  current: FeatureOverrides;
  patch: Partial<Record<FeatureKey, FeatureOverrideValue>>;
  requestedKeys: FeatureKey[];
  presetId?: FeaturePresetId;
  liveEvent?: boolean;
  summary?: string;
}): ConfigDiffCard {
  const validated = assertRegistryKeys(opts.patch as Record<string, unknown>);
  let next: FeatureOverrides = { ...opts.current };
  if (opts.presetId) {
    next = { ...next, ...applyPreset(opts.presetId) };
  }
  next = { ...next, ...validated };

  const before = normalizeOverridesForSave(opts.current).overrides;
  const { overrides: after, forcedOff } = normalizeOverridesForSave(next);

  const requested = new Set(opts.requestedKeys);
  const forcedKeys = new Set(forcedOff.map((f) => f.key));

  const entries: ConfigDiffEntry[] = [];

  for (const def of FEATURE_REGISTRY) {
    const key = def.key;
    const from = displayValue(key, before);
    const to = displayValue(key, after);
    if (valuesEqual(from, to) && !forcedKeys.has(key)) continue;
    if (valuesEqual(from, to) && !requested.has(key) && !forcedKeys.has(key)) continue;

    const forced = forcedOff.find((f) => f.key === key);
    let reason: ConfigDiffEntry["reason"] = "requested";
    if (forced) reason = "dependency";
    else if (opts.presetId && !requested.has(key)) reason = "preset";
    else if (!requested.has(key)) reason = "dependency";

    // Skip unchanged effective values unless forced
    if (valuesEqual(from, to) && !forced) continue;

    const entry: ConfigDiffEntry = {
      key,
      name: def.name,
      plainDescription: def.plainDescription,
      from,
      to,
      reason,
    };
    if (forced) {
      entry.dependencyNote = forced.reason;
    } else if (reason === "dependency" && key === "matchmaker" && after.attendee_directory === false) {
      entry.dependencyNote = "Turning off the directory also turns off the matchmaker";
    }
    if (opts.liveEvent && to === false) {
      entry.liveImpact =
        LIVE_FEATURE_IMPACT[key] || `${def.name} is hidden immediately; existing data is preserved.`;
    }
    entries.push(entry);
  }

  return {
    title: "Review feature changes",
    summary:
      opts.summary ||
      (entries.length
        ? `These ${entries.length} setting${entries.length === 1 ? "" : "s"} will change when you confirm.`
        : "No settings would change."),
    entries,
    proposedOverrides: after,
    aiGenerated: true,
  };
}
