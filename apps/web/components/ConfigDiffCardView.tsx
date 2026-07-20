import type { ConfigDiffCard } from "@event-app/shared";
import { AiGeneratedChip } from "./AiGeneratedChip";

type Props = {
  card: ConfigDiffCard;
  confirming?: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
};

function formatValue(v: unknown): string {
  if (v === true) return "On";
  if (v === false) return "Off";
  if (v === "default") return "Default";
  return String(v);
}

/** Reviewable feature-config diff — applies only on confirm. */
export function ConfigDiffCardView({ card, confirming, onConfirm, onDismiss }: Props) {
  return (
    <div
      className="config-diff-card"
      role="region"
      aria-label="Feature changes to review"
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "12px 14px",
        background: "var(--surface-alt)",
        marginTop: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
        <h3 className="text-display-sm" style={{ margin: 0, fontSize: 16 }}>
          {card.title}
        </h3>
        <AiGeneratedChip />
      </div>
      <p className="help-text" style={{ margin: "8px 0 12px" }}>
        {card.summary}
      </p>
      {card.entries.length === 0 ? (
        <p className="help-text">No changes.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
          {card.entries.map((e) => (
            <li
              key={e.key}
              style={{
                padding: "8px 10px",
                background: "var(--surface, #fff)",
                borderRadius: 6,
                border: "1px solid var(--border)",
              }}
            >
              <div style={{ fontWeight: 600 }}>{e.name}</div>
              <div className="help-text" style={{ marginTop: 2 }}>
                {e.plainDescription}
              </div>
              <div style={{ marginTop: 6, fontSize: 14 }}>
                {formatValue(e.from)} → <strong>{formatValue(e.to)}</strong>
                {e.reason === "dependency" ? (
                  <span className="help-text"> (dependency)</span>
                ) : null}
              </div>
              {e.dependencyNote ? (
                <p className="help-text" style={{ margin: "4px 0 0", color: "var(--ink-secondary, #41506D)" }}>
                  {e.dependencyNote}
                </p>
              ) : null}
              {e.liveImpact ? (
                <p className="help-text" style={{ margin: "4px 0 0", color: "var(--danger-700, #C22F2F)" }}>
                  {e.liveImpact}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button type="button" className="button" disabled={confirming || card.entries.length === 0} onClick={onConfirm}>
          {confirming ? "Applying…" : "Confirm changes"}
        </button>
        <button type="button" className="button secondary" disabled={confirming} onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
