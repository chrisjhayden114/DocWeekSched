/**
 * Feature registry lives in @event-app/shared; API re-exports + DB-backed featureEnabled.
 */
export {
  FEATURE_REGISTRY,
  FEATURE_BY_KEY,
  FEATURE_PRESETS,
  getOrganizerVisibleFeatures,
  dependencyBlockReason,
  featureKeyForNetworkChannel,
  resolveFeatureEnabled,
  applyPreset,
  normalizeOverridesForSave,
  type FeatureKey,
  type FeatureOverrideValue,
  type FeatureDefinition,
  type FeaturePresetId,
  type FeaturePreset,
  type FeatureCategory,
} from "@event-app/shared";
