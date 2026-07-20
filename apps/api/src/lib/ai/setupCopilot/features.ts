/**
 * Typed feature tools for the Setup Copilot (A2) — DB-backed read/apply.
 */

import {
  FEATURE_REGISTRY,
  resolveFeatureEnabled,
  type FeatureKey,
  type FeatureOverrideValue,
} from "@event-app/shared";
import type { FeatureOverrides } from "../../features/featureEnabled";
import {
  loadFeatureOverrides,
  upsertFeatureOverrides,
} from "../../features/featureEnabled";
import { writeAuditLog } from "../audit";
import { buildConfigDiffCard } from "./diffCard";
import { assertRegistryKeys } from "./keys";

export type ReadFeatureConfigResult = {
  overrides: FeatureOverrides;
  effective: Partial<Record<FeatureKey, boolean>>;
  aiGenerated: true;
};

export { assertRegistryKeys, UnknownFeatureKeyError } from "./keys";
export const proposeConfigureFeatures = buildConfigDiffCard;

export async function readFeatureConfig(eventId: string | null | undefined): Promise<ReadFeatureConfigResult> {
  const overrides = eventId ? await loadFeatureOverrides(eventId) : {};
  const effective: Partial<Record<FeatureKey, boolean>> = {};
  for (const def of FEATURE_REGISTRY) {
    effective[def.key] = resolveFeatureEnabled(def.key, overrides);
  }
  return { overrides, effective, aiGenerated: true };
}

/**
 * Apply confirmed overrides — writes EventFeatureConfig + A0 audit (AI_TOOL).
 */
export async function applyConfigureFeatures(opts: {
  eventId: string;
  organizationId: string;
  actorUserId: string;
  overrides: Partial<Record<FeatureKey, FeatureOverrideValue>>;
  liveEvent?: boolean;
  diffSummary?: string;
}): Promise<{
  overrides: FeatureOverrides;
  forcedOff: { key: FeatureKey; reason: string }[];
  aiGenerated: true;
}> {
  const validated = assertRegistryKeys(opts.overrides as Record<string, unknown>);
  const current = await loadFeatureOverrides(opts.eventId);
  const merged = { ...current, ...validated };
  const { overrides, forcedOff } = await upsertFeatureOverrides(opts.eventId, merged);

  await writeAuditLog({
    organizationId: opts.organizationId,
    eventId: opts.eventId,
    actorUserId: opts.actorUserId,
    action: "AI_TOOL",
    entityType: "event_feature_config",
    entityId: opts.eventId,
    aiGenerated: true,
    payload: {
      tool: "configureFeatures",
      overrides: validated,
      applied: overrides,
      forcedOff,
      liveEvent: !!opts.liveEvent,
      summary: opts.diffSummary || null,
    },
  });

  return { overrides, forcedOff, aiGenerated: true };
}
