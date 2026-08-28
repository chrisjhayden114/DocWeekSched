import { useEffect, useRef, useState } from "react";
import { ASSISTANT_COPY, type SetupCopilotFormState } from "@event-app/shared";
import { AssistantMark } from "./AssistantMark";
import { SetupCopilotChat } from "./SetupCopilotChat";

const DESKTOP_MQ = "(min-width: 1024px)";
const OPEN_STORAGE_PREFIX = "copilotOpen:";
const LAST_EVENT_STORAGE_KEY = "copilotDockEventId";
const OPEN_EVENT = "organizer-assistant-open";
const FEATURES_APPLIED_EVENT = "setup-copilot-features-applied";

const ORGANIZER_ASSISTANT = ASSISTANT_COPY.organizer;

/** sessionStorage key for this event's dock open state (K-3 / AGENT-3.1). */
export function copilotOpenStorageKey(eventId: string): string {
  return `${OPEN_STORAGE_PREFIX}${eventId}`;
}

/** Open the console dock from Overview / Features (or any organizer surface). */
export function openOrganizerAssistantDock() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OPEN_EVENT));
}

type Props = {
  eventId: string;
  organizationId?: string;
};

export function OrganizerAssistantDock({ eventId, organizationId }: Props) {
  const [open, setOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const persistReady = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_MQ);
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Per-event open key + close-on-event-switch (AGENT-3.1 moved here).
  useEffect(() => {
    try {
      const last = sessionStorage.getItem(LAST_EVENT_STORAGE_KEY);
      const switched = Boolean(last && last !== eventId);
      sessionStorage.setItem(LAST_EVENT_STORAGE_KEY, eventId);
      if (switched) {
        setOpen(false);
        return;
      }
      if (sessionStorage.getItem(copilotOpenStorageKey(eventId)) === "1") setOpen(true);
    } catch {
      /* private mode / blocked storage */
    }
  }, [eventId]);

  useEffect(() => {
    // Skip the first run so we don't wipe a stored "1" before restore.
    if (!persistReady.current) {
      persistReady.current = true;
      return;
    }
    try {
      sessionStorage.setItem(copilotOpenStorageKey(eventId), open ? "1" : "0");
    } catch {
      /* private mode / blocked storage */
    }
    // eventId from the render that changed `open` — a switch must not copy
    // the previous event's open bit onto the new key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !isDesktop) {
      document.body.classList.remove("copilot-docked");
      return;
    }
    document.body.classList.add("copilot-docked");
    return () => document.body.classList.remove("copilot-docked");
  }, [open, isDesktop]);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  function onFeaturesApplied(overrides: SetupCopilotFormState["featureOverrides"]) {
    window.dispatchEvent(new CustomEvent(FEATURES_APPLIED_EVENT, { detail: overrides }));
  }

  const chatBody = (
    <>
      <header className="concierge-sheet-header">
        <div>
          <h2
            id="copilot-title"
            className="text-display-sm"
            style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}
          >
            <span className="concierge-header-mark" aria-hidden>
              <AssistantMark size={20} />
            </span>
            {ORGANIZER_ASSISTANT.name}
          </h2>
          <p className="help-text" style={{ margin: "4px 0 0" }}>
            {ORGANIZER_ASSISTANT.description}
          </p>
        </div>
        <button type="button" className="button secondary" onClick={() => setOpen(false)}>
          Close
        </button>
      </header>
      <SetupCopilotChat
        key={eventId}
        mode="settings"
        eventId={eventId}
        organizationId={organizationId}
        onFormChange={() => {}}
        onFeaturesApplied={onFeaturesApplied}
        compact
      />
    </>
  );

  const showFab = !open || !isDesktop;

  return (
    <>
      {showFab ? (
        <button
          type="button"
          className="copilot-fab"
          aria-label={`Open ${ORGANIZER_ASSISTANT.name}`}
          onClick={() => setOpen(true)}
        >
          <span className="copilot-fab-icon" aria-hidden>
            <AssistantMark size={18} />
          </span>
          <span className="copilot-fab-label">{ORGANIZER_ASSISTANT.name}</span>
        </button>
      ) : null}

      {open && isDesktop ? (
        <aside
          aria-label={ORGANIZER_ASSISTANT.name}
          className="copilot-panel"
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
        >
          {chatBody}
        </aside>
      ) : null}

      {open && !isDesktop ? (
        <div className="copilot-sheet-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div
            className="copilot-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="copilot-title"
            onClick={(e) => e.stopPropagation()}
          >
            {chatBody}
          </div>
        </div>
      ) : null}
    </>
  );
}

/** One-line entry that opens the dock — Overview checklist + Features tab. */
export function AskSetupAssistantLink({ className }: { className?: string }) {
  return (
    <button type="button" className={className ?? "button ghost"} onClick={() => openOrganizerAssistantDock()}>
      Ask the {ORGANIZER_ASSISTANT.name.toLowerCase()} →
    </button>
  );
}

/** CustomEvent name fired when the dock confirms feature overrides. */
export const SETUP_COPILOT_FEATURES_APPLIED = FEATURES_APPLIED_EVENT;
