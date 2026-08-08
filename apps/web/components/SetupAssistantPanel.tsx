import Link from "next/link";
import { useMemo, useState } from "react";
import { overviewCopy } from "@event-app/config";
import { ASSISTANT_COPY, type SetupCopilotFormState } from "@event-app/shared";
import { buildSetupChecklist, nextSetupStep, type SetupChecklistInput } from "../lib/setupChecklist";
import { SetupCopilotChat } from "./SetupCopilotChat";

/**
 * E19.3 (restyled in F2) — the "Before you publish" checklist, the seed of
 * the content-first Overview. Reads live event state, names the next
 * incomplete step, and deep-links to the tab that fixes it. Each item is
 * done (✓) / attention (the next step, highlighted) / todo (○). The chat
 * is secondary and opt-in; the checklist is the assistant.
 */
type Props = {
  input: SetupChecklistInput;
  organizationId?: string;
  /** Forwarded to the embedded chat so feature confirmations behave the same everywhere. */
  onFeaturesApplied?: (overrides: SetupCopilotFormState["featureOverrides"]) => void;
};

export function SetupAssistantPanel({ input, organizationId, onFeaturesApplied }: Props) {
  const [chatOpen, setChatOpen] = useState(false);
  const items = useMemo(() => buildSetupChecklist(input), [input]);
  const next = nextSetupStep(items);

  return (
    <div className="console-panel setup-assistant-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <p className="console-panel-label">
          {input.status === "ACTIVE" ? overviewCopy.checklist.titleLive : overviewCopy.checklist.title}
        </p>
        <button type="button" className="button secondary" onClick={() => setChatOpen((v) => !v)}>
          {chatOpen ? "Hide chat" : `Ask the ${ASSISTANT_COPY.organizer.name.toLowerCase()}`}
        </button>
      </div>

      {next ? (
        <p className="help-text" style={{ margin: "0 0 12px" }}>
          <strong style={{ color: "var(--gray-900)" }}>{overviewCopy.checklist.nextStepLabel}</strong> {next.label} —{" "}
          {next.detail}
        </p>
      ) : (
        <p className="help-text" style={{ margin: "0 0 12px" }}>
          <strong style={{ color: "var(--gray-900)" }}>{overviewCopy.checklist.complete}</strong>
        </p>
      )}

      <ul className="setup-checklist">
        {items.map((item) => {
          const state = item.done ? "done" : item.key === next?.key ? "attention" : "todo";
          return (
            <li key={item.key} className={`setup-checklist-item setup-checklist-item--${state}`}>
              <span className="setup-checklist-icon" aria-hidden>
                {item.done ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                ) : state === "attention" ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="8" />
                  </svg>
                )}
              </span>
              <span className="setup-checklist-text">
                <span className="setup-checklist-label">{item.label}</span>{" "}
                <span className="help-text">{item.detail}</span>{" "}
                {!item.done ? <Link href={item.href}>{item.linkLabel}</Link> : null}
              </span>
            </li>
          );
        })}
      </ul>

      {chatOpen ? (
        <div style={{ marginTop: 12 }}>
          <SetupCopilotChat
            mode="settings"
            eventId={input.eventId}
            organizationId={organizationId}
            onFormChange={() => {}}
            onFeaturesApplied={onFeaturesApplied}
            compact
          />
        </div>
      ) : null}
    </div>
  );
}
