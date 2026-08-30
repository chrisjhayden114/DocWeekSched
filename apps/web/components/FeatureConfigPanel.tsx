import { useEffect, useMemo, useState } from "react";
import {
  FEATURE_GUIDE,
  FEATURE_PRESETS,
  getOrganizerVisibleFeatures,
  normalizeOverridesForSave,
  resolveFeatureEnabled,
  type FeatureKey,
  type FeatureOverrideValue,
  type FeaturePresetId,
} from "@event-app/shared";
import { applyBrandTokens } from "../lib/brandTokens";
import { featureGuideImage, featureGuideImageSources } from "../lib/featureGuideImage";
import { FeatureArt } from "./featureArt";
import { ConfirmDialog } from "./ConfirmDialog";
import { HoverInfo, preloadImage } from "./kit/HoverInfo";

export type FeatureOverridesMap = Partial<Record<FeatureKey, FeatureOverrideValue>>;

const CATEGORY_LABEL: Record<string, string> = {
  community: "Community",
  messaging: "Messaging",
  sessions: "Sessions",
  engagement: "Engagement",
  schedule: "Schedule",
  directory: "Directory",
};

/** E16.5: each group states its purpose once, instead of repeating boilerplate per row. */
const CATEGORY_PURPOSE: Record<string, string> = {
  community: "Spaces where attendees post and reply to each other.",
  messaging: "Private conversations between attendees.",
  sessions: "What attendees can do on each session page.",
  engagement: "Participation, check-in, sponsors, and event-day operations.",
  schedule: "How attendees view the program.",
  directory: "Finding and meeting other attendees.",
};

type Props = {
  overrides: FeatureOverridesMap;
  onChange: (next: FeatureOverridesMap) => void;
  /** When true, toggling off shows a data-preservation confirm. */
  confirmOff?: boolean;
  showPresets?: boolean;
};

/**
 * Organizer feature toggles — wizard step and settings tab.
 */
export function FeatureConfigPanel({ overrides, onChange, confirmOff = true, showPresets = true }: Props) {
  const visible = useMemo(() => getOrganizerVisibleFeatures(), []);
  const [pendingOff, setPendingOff] = useState<FeatureKey | null>(null);

  useEffect(() => {
    for (const src of featureGuideImageSources()) preloadImage(src);
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof visible>();
    for (const f of visible) {
      const list = map.get(f.category) || [];
      list.push(f);
      map.set(f.category, list);
    }
    return map;
  }, [visible]);

  function applyPreset(id: FeaturePresetId) {
    const preset = FEATURE_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    const { overrides: next } = normalizeOverridesForSave({ ...overrides, ...preset.overrides });
    onChange(next);
  }

  function setKey(key: FeatureKey, value: boolean) {
    const enabled = resolveFeatureEnabled(key, overrides);
    if (confirmOff && enabled && !value) {
      setPendingOff(key);
      return;
    }
    const { overrides: next } = normalizeOverridesForSave({ ...overrides, [key]: value });
    onChange(next);
  }

  const pendingDef = pendingOff ? visible.find((f) => f.key === pendingOff) : null;

  return (
    <div className="feature-config-panel">
      {showPresets ? (
        <div style={{ marginBottom: "var(--space-4)" }}>
          <p className="field-label-text" style={{ marginBottom: "var(--space-2)" }}>
            Starting presets
          </p>
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
            {FEATURE_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="button secondary"
                title={p.plainDescription}
                onClick={() => applyPreset(p.id)}
              >
                {p.name}
              </button>
            ))}
          </div>
          <p className="text-meta" style={{ marginTop: "var(--space-2)" }}>
            Presets set toggles; you can adjust freely after.
          </p>
        </div>
      ) : null}

      {[...grouped.entries()].map(([category, features]) => (
        <section key={category} style={{ marginBottom: "var(--space-5)" }}>
          <h3 className="text-display-sm" style={{ margin: "0 0 var(--space-1)" }}>
            {CATEGORY_LABEL[category] || category}
          </h3>
          {CATEGORY_PURPOSE[category] ? (
            <p className="text-meta" style={{ margin: "0 0 var(--space-3)" }}>
              {CATEGORY_PURPOSE[category]}
            </p>
          ) : null}
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "var(--space-2)" }}>
            {features.map((f) => {
              const enabled = resolveFeatureEnabled(f.key, overrides);
              const offParents = (f.dependsOn || []).filter((p) => !resolveFeatureEnabled(p, overrides));
              const blocked =
                offParents.length > 0
                  ? f.key === "matchmaker"
                    ? "Matchmaker needs the attendee directory"
                    : offParents.includes("community")
                      ? "This channel needs Community to be on"
                      : `Requires ${offParents.join(", ")}`
                  : null;
              return (
                <li
                  key={f.key}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-md)",
                    padding: "var(--space-3)",
                    background: "var(--surface)",
                  }}
                >
                  <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-start" }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <HoverInfo
                        trigger="label"
                        hideIcon
                        title={f.name}
                        featureKey={f.key}
                        body={applyBrandTokens(FEATURE_GUIDE[f.key].whatItDoes)}
                        imageSrc={featureGuideImage(f.key)}
                        image={<FeatureArt category={f.category} />}
                      >
                        <strong className="text-body-md" style={{ color: "var(--ink-900)" }} id={`feature-name-${f.key}`}>
                          {f.name}
                        </strong>
                      </HoverInfo>
                      <span className="text-meta" style={{ display: "block" }}>
                        {f.plainDescription}
                      </span>
                      {blocked ? (
                        <span className="text-meta" style={{ display: "block", color: "var(--ink-secondary)", marginTop: "var(--space-1)" }}>
                          {blocked}
                        </span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={enabled}
                      aria-labelledby={`feature-name-${f.key}`}
                      className="switch"
                      disabled={Boolean(blocked) && !enabled}
                      onClick={() => setKey(f.key, !enabled)}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <ConfirmDialog
        open={Boolean(pendingOff && pendingDef)}
        title={`Turn off ${pendingDef?.name || "this feature"}?`}
        body={`Attendees will no longer see ${pendingDef?.name || "this feature"} — existing posts, messages, and Q&A are preserved, not deleted. You can turn it back on anytime.`}
        confirmLabel="Turn off"
        onCancel={() => setPendingOff(null)}
        onConfirm={() => {
          if (!pendingOff) return;
          const { overrides: next } = normalizeOverridesForSave({ ...overrides, [pendingOff]: false });
          onChange(next);
          setPendingOff(null);
        }}
      />
    </div>
  );
}
