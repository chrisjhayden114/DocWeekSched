import Link from "next/link";
import { useMemo, useState } from "react";
import { ASSISTANT_COPY, type SetupCopilotFormState } from "@event-app/shared";
import { buildSetupChecklist, nextSetupStep, type SetupChecklistInput } from "../lib/setupChecklist";
import { SetupCopilotChat } from "./SetupCopilotChat";

/**
 * E19.3 — the Setup assistant's persistent home in the console. Reads live
 * event state, names the next incomplete step, and deep-links to the tab that
 * fixes it. The chat is secondary and opt-in; the checklist is the assistant.
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
        <p className="console-panel-label">{ASSISTANT_COPY.organizer.name}</p>
        <button type="button" className="button secondary" onClick={() => setChatOpen((v) => !v)}>
          {chatOpen ? "Hide chat" : `Ask the ${ASSISTANT_COPY.organizer.name.toLowerCase()}`}
        </button>
      </div>
      <p className="help-text" style={{ marginTop: 0 }}>
        {ASSISTANT_COPY.organizer.description}
      </p>

      {next ? (
        <p style={{ margin: "0 0 10px" }}>
          <strong>Next step:</strong> {next.label} — {next.detail}{" "}
          <Link href={next.href}>{next.linkLabel}</Link>
        </p>
      ) : (
        <p style={{ margin: "0 0 10px" }}>
          <strong>Setup complete.</strong> Sessions, rooms, speakers, and venue are in place and the event is live.
        </p>
      )}

      <ul className="setup-checklist" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
        {items.map((item) => (
          <li key={item.key} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
            <span aria-hidden style={{ color: item.done ? "var(--success)" : "var(--text-muted)" }}>
              {item.done ? "✓" : "○"}
            </span>
            <span style={{ flex: 1 }}>
              <span style={{ fontWeight: item.done ? 400 : 600 }}>{item.label}</span>{" "}
              <span className="help-text">{item.detail}</span>{" "}
              {!item.done ? <Link href={item.href}>{item.linkLabel}</Link> : null}
            </span>
          </li>
        ))}
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
