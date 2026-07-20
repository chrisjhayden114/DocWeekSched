import { prisma } from "../db";
import { HttpError } from "../authorization";
import { can } from "../billing/entitlements";
import {
  FEATURE_BY_KEY,
  FEATURE_REGISTRY,
  resolveFeatureEnabled,
  normalizeOverridesForSave,
  dependencyBlockReason,
  type FeatureKey,
  type FeatureOverrideValue,
  type FeaturePresetId,
  applyPreset,
} from "./registry";

export type FeatureOverrides = Partial<Record<FeatureKey, FeatureOverrideValue>>;

/** Plan entitlement AND — wired to can(org, feature). */
export async function planAllowsFeature(orgId: string | null | undefined, key: FeatureKey): Promise<boolean> {
  if (!orgId) return true;
  return can(orgId, key);
}

function asOverrides(raw: unknown): FeatureOverrides {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: FeatureOverrides = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(k in FEATURE_BY_KEY)) continue;
    const key = k as FeatureKey;
    if (typeof v === "boolean") out[key] = v;
    else if (v === "daily" || v === "weekly" || v === "interrupts_only") out[key] = v;
  }
  return out;
}

export function resolveFeatureValue(key: FeatureKey, overrides: FeatureOverrides): FeatureOverrideValue {
  const def = FEATURE_BY_KEY[key];
  const override = overrides[key];
  if (override !== undefined) return override;
  return def.defaultValue ?? def.defaultOn;
}

export async function loadFeatureOverrides(eventId: string): Promise<FeatureOverrides> {
  const row = await prisma.eventFeatureConfig.findUnique({ where: { eventId } });
  return asOverrides(row?.overrides);
}

export async function featureEnabled(eventId: string, key: FeatureKey): Promise<boolean> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { organizationId: true },
  });
  if (!event) return false;
  const overrides = await loadFeatureOverrides(eventId);
  const planAllows = await planAllowsFeature(event.organizationId, key);
  return resolveFeatureEnabled(key, overrides, { planAllows });
}

export async function requireFeature(eventId: string, key: FeatureKey): Promise<void> {
  const ok = await featureEnabled(eventId, key);
  if (!ok) {
    throw new HttpError(404, { error: "Feature not available for this event" });
  }
}

export function mergeOverrides(current: FeatureOverrides, patch: FeatureOverrides): FeatureOverrides {
  return { ...current, ...patch };
}

export type FeatureStateRow = {
  key: FeatureKey;
  name: string;
  plainDescription: string;
  category: string;
  enabled: boolean;
  value: FeatureOverrideValue;
  defaultOn: boolean;
  dependsOn?: FeatureKey[];
  plannedPhase?: string;
  blockedReason: string | null;
  organizerVisible: boolean;
};

export async function buildFeatureState(
  overrides: FeatureOverrides,
  orgId?: string | null,
): Promise<FeatureStateRow[]> {
  const rows: FeatureStateRow[] = [];
  for (const def of FEATURE_REGISTRY) {
    const planAllows = await planAllowsFeature(orgId, def.key);
    const enabled = resolveFeatureEnabled(def.key, overrides, { planAllows });
    const offParents: FeatureKey[] = [];
    for (const p of def.dependsOn || []) {
      const parentPlan = await planAllowsFeature(orgId, p);
      if (!resolveFeatureEnabled(p, overrides, { planAllows: parentPlan })) offParents.push(p);
    }
    rows.push({
      key: def.key,
      name: def.name,
      plainDescription: def.plainDescription,
      category: def.category,
      enabled,
      value: resolveFeatureValue(def.key, overrides),
      defaultOn: def.defaultOn,
      dependsOn: def.dependsOn,
      plannedPhase: def.plannedPhase,
      blockedReason: dependencyBlockReason(def.key, offParents),
      organizerVisible: !def.plannedPhase,
    });
  }
  return rows;
}

export async function upsertFeatureOverrides(
  eventId: string,
  next: FeatureOverrides,
): Promise<{ overrides: FeatureOverrides; forcedOff: { key: FeatureKey; reason: string }[] }> {
  const { overrides, forcedOff } = normalizeOverridesForSave(next);
  await prisma.eventFeatureConfig.upsert({
    where: { eventId },
    create: { eventId, overrides },
    update: { overrides },
  });
  return { overrides, forcedOff };
}

export { applyPreset };
export type { FeaturePresetId };
