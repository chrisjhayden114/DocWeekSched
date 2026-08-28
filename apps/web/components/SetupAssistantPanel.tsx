import Link from "next/link";
import { useMemo } from "react";
import { overviewCopy } from "@event-app/config";
import { buildSetupChecklist, nextSetupStep, type SetupChecklistInput } from "../lib/setupChecklist";
import { AskSetupAssistantLink } from "./OrganizerAssistantDock";

/**
 * E19.3 (restyled in F2; K-3 dock) — the "Before you publish" checklist, the
 * seed of the content-first Overview. Reads live event state, names the next
 * incomplete step, and deep-links to the tab that fixes it. Each item is
 * done (✓) / attention (the next step, highlighted) / todo (○). Chat lives
 * in OrganizerAssistantDock; this card only links to it.
 */
type Props = {
  input: SetupChecklistInput;
};

export function SetupAssistantPanel({ input }: Props) {
  const items = useMemo(() => buildSetupChecklist(input), [input]);
  const next = nextSetupStep(items);

  return (
    <div className="console-panel setup-assistant-panel">
      <p className="console-panel-label">
        {input.status === "ACTIVE" ? overviewCopy.checklist.titleLive : overviewCopy.checklist.title}
      </p>

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

      <p className="help-text" style={{ margin: "12px 0 0" }}>
        <AskSetupAssistantLink />
      </p>
    </div>
  );
}
