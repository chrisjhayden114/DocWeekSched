import { useMemo, useState } from "react";
import {
  FEATURE_PRESETS,
  getOrganizerVisibleFeatures,
  normalizeOverridesForSave,
  resolveFeatureEnabled,
  type FeatureKey,
  type FeatureOverrideValue,
  type FeaturePresetId,
} from "@event-app/shared";
import { ConfirmDialog } from "./ConfirmDialog";

export type FeatureOverridesMap = Partial<Record<FeatureKey, FeatureOverrideValue>>;

const CATEGORY_LABEL: Record<string, string> = {
  community: "Community",
  messaging: "Messaging",
  sessions: "Sessions",
  engagement: "Engagement",
  schedule: "Schedule",
  directory: "Directory",
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
          <h3 className="text-display-sm" style={{ margin: "0 0 var(--space-3)" }}>
            {CATEGORY_LABEL[category] || category}
          </h3>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "var(--space-3)" }}>
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
                  <label style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-start", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={enabled}
                      disabled={Boolean(blocked) && !enabled}
                      onChange={(e) => setKey(f.key, e.target.checked)}
                      style={{ marginTop: 4 }}
                    />
                    <span>
                      <strong className="text-body-md" style={{ display: "block" }}>
                        {f.name}
                      </strong>
                      <span className="text-meta">{f.plainDescription}</span>
                      {blocked ? (
                        <span className="text-meta" style={{ display: "block", color: "var(--ink-secondary)", marginTop: 4 }}>
                          {blocked}
                        </span>
                      ) : null}
                      <span
                        className="text-meta"
                        style={{ display: "block", marginTop: 6, color: "var(--ink-secondary)" }}
                      >
                        Attendees see: {enabled ? "this feature in the app" : "nothing for this feature (data kept)"}
                      </span>
                    </span>
                  </label>
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
