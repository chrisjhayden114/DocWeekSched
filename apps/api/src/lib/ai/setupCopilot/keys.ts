/**
 * Registry key validation — pure (no Prisma).
 */

import { FEATURE_BY_KEY, type FeatureKey, type FeatureOverrideValue } from "@event-app/shared";

export class UnknownFeatureKeyError extends Error {
  readonly unknownKeys: string[];
  constructor(unknownKeys: string[]) {
    super(`Unknown feature key(s): ${unknownKeys.join(", ")}`);
    this.name = "UnknownFeatureKeyError";
    this.unknownKeys = unknownKeys;
  }
}

/** Reject any key not in the Phase 2.6 registry. */
export function assertRegistryKeys(
  overrides: Record<string, unknown>,
): Partial<Record<FeatureKey, FeatureOverrideValue>> {
  const unknown: string[] = [];
  const out: Partial<Record<FeatureKey, FeatureOverrideValue>> = {};
  for (const [k, v] of Object.entries(overrides)) {
    if (!(k in FEATURE_BY_KEY)) {
      unknown.push(k);
      continue;
    }
    const key = k as FeatureKey;
    if (typeof v === "boolean") out[key] = v;
    else if (v === "daily" || v === "weekly" || v === "interrupts_only") out[key] = v;
    else unknown.push(`${k} (invalid value)`);
  }
  if (unknown.length) throw new UnknownFeatureKeyError(unknown);
  return out;
}
