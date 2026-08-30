import { useMemo, useState } from "react";
import type {
  SetupConflictCard,
  SetupConflictChoice,
  SetupConflictChoices,
} from "@event-app/shared";
import { AiGeneratedChip } from "./AiGeneratedChip";

type Props = {
  card: SetupConflictCard;
  applying?: boolean;
  onApply: (choices: SetupConflictChoices) => void;
  onDismiss: () => void;
};

/**
 * W-4 (SETUP-CONFLICT) — the reviewable "current → proposed" card the Setup
 * assistant shows instead of overwriting an answer the organizer confirmed.
 * Same review shape as the feature diff card: nothing here is applied until
 * the organizer picks, per field, and Keep mine is always the default.
 */
export function SetupConflictCardView({ card, applying, onApply, onDismiss }: Props) {
  const [choices, setChoices] = useState<SetupConflictChoices>({});

  const chosen = useMemo(
    () => card.entries.filter((e) => (choices[e.field] ?? "keep") === "use_new").length,
    [card.entries, choices],
  );

  function setAll(choice: SetupConflictChoice) {
    const next: SetupConflictChoices = {};
    for (const entry of card.entries) next[entry.field] = choice;
    setChoices(next);
  }

  return (
    <div
      className="setup-conflict-card"
      role="region"
      aria-label="Answers to reconcile"
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "12px 14px",
        background: "var(--surface-alt)",
        marginTop: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "baseline",
        }}
      >
        <h3 className="text-display-sm" style={{ margin: 0, fontSize: 16 }}>
          {card.title}
        </h3>
        <AiGeneratedChip />
      </div>
      <p className="help-text" style={{ margin: "8px 0 12px" }}>
        {card.summary}
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          className="button secondary"
          style={{ padding: "2px 8px", fontSize: 13 }}
          disabled={applying}
          onClick={() => setAll("keep")}
        >
          Keep all mine
        </button>
        <button
          type="button"
          className="button secondary"
          style={{ padding: "2px 8px", fontSize: 13 }}
          disabled={applying}
          onClick={() => setAll("use_new")}
        >
          Use all new
        </button>
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
        {card.entries.map((entry) => {
          const choice = choices[entry.field] ?? "keep";
          return (
            <li
              key={entry.field}
              style={{
                padding: "8px 10px",
                background: "var(--surface, #fff)",
                borderRadius: 6,
                border: "1px solid var(--border)",
              }}
            >
              <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
                <legend style={{ fontWeight: 600, padding: 0 }}>{entry.label}</legend>
                <div style={{ marginTop: 6, fontSize: 14 }}>
                  {entry.current} → <strong>{entry.proposed}</strong>
                </div>
                <div style={{ display: "flex", gap: 14, marginTop: 6, flexWrap: "wrap" }}>
                  {(
                    [
                      { value: "keep" as const, label: `Keep mine (${entry.current})` },
                      { value: "use_new" as const, label: `Use new (${entry.proposed})` },
                    ] satisfies Array<{ value: SetupConflictChoice; label: string }>
                  ).map((option) => (
                    <label
                      key={option.value}
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14 }}
                    >
                      <input
                        type="radio"
                        name={`setup-conflict-${entry.field}`}
                        value={option.value}
                        checked={choice === option.value}
                        disabled={applying}
                        onChange={() =>
                          setChoices((prev) => ({ ...prev, [entry.field]: option.value }))
                        }
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            </li>
          );
        })}
      </ul>
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button type="button" className="button" disabled={applying} onClick={() => onApply(choices)}>
          {applying
            ? "Applying…"
            : chosen === 0
              ? "Keep my answers"
              : `Apply ${chosen} change${chosen === 1 ? "" : "s"}`}
        </button>
        <button type="button" className="button secondary" disabled={applying} onClick={onDismiss}>
          Decide later
        </button>
      </div>
    </div>
  );
}
