import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ConfigDiffCard,
  SetupCopilotFormState,
  SetupCopilotMessage,
  SetupCopilotMode,
  SetupCopilotStep,
  SetupHandoffA1,
} from "@event-app/shared";
import { emptySetupFormState } from "@event-app/shared";
import { apiFetch } from "../lib/api";
import { AiGeneratedChip } from "./AiGeneratedChip";
import { ConfigDiffCardView } from "./ConfigDiffCardView";

export type SetupCopilotChatProps = {
  mode: SetupCopilotMode;
  organizationId?: string;
  eventId?: string;
  /** Called whenever form state updates from the conversation. */
  onFormChange: (form: SetupCopilotFormState) => void;
  /** Initial form (e.g. preserved from a prior session). */
  initialForm?: Partial<SetupCopilotFormState>;
  onHandoff?: (handoff: SetupHandoffA1, form: SetupCopilotFormState) => void;
  onCompleteReady?: (form: SetupCopilotFormState) => void;
  /** When features are confirmed against a live/draft event. */
  onFeaturesApplied?: (overrides: SetupCopilotFormState["featureOverrides"]) => void;
  compact?: boolean;
};

type TurnResponse = {
  step: SetupCopilotStep;
  form: SetupCopilotFormState;
  messages: SetupCopilotMessage[];
  assistantMessage: string;
  pendingDiff: ConfigDiffCard | null;
  handoff: SetupHandoffA1 | null;
  skeletonPreview: unknown;
  aiGenerated: true;
  liveEvent?: boolean;
};

export function SetupCopilotChat({
  mode,
  organizationId,
  eventId,
  onFormChange,
  initialForm,
  onHandoff,
  onCompleteReady,
  onFeaturesApplied,
  compact,
}: SetupCopilotChatProps) {
  const [step, setStep] = useState<SetupCopilotStep>(mode === "settings" ? "settings_chat" : "name");
  const [form, setForm] = useState<SetupCopilotFormState>(() => ({
    ...emptySetupFormState(
      typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" : "UTC",
    ),
    ...initialForm,
  }));
  const [messages, setMessages] = useState<SetupCopilotMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDiff, setPendingDiff] = useState<ConfigDiffCard | null>(null);
  const [confirming, setConfirming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const syncForm = useCallback(
    (next: SetupCopilotFormState) => {
      setForm(next);
      onFormChange(next);
    },
    [onFormChange],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const tz =
          typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" : "UTC";
        const q = new URLSearchParams({ mode, timezone: tz });
        if (eventId) q.set("eventId", eventId);
        const res = await apiFetch<{
          step: SetupCopilotStep;
          form: SetupCopilotFormState;
          messages: SetupCopilotMessage[];
        }>(`/ai/setup-copilot/start?${q}`);
        setStep(res.step);
        setMessages(res.messages);
        syncForm({ ...res.form, ...initialForm });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not start assistant");
      }
    })();
  }, [mode, eventId, initialForm, syncForm]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pendingDiff]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setInput("");
    try {
      const res = await apiFetch<TurnResponse>("/ai/setup-copilot/turn", {
        method: "POST",
        body: JSON.stringify({
          mode,
          organizationId,
          eventId,
          step,
          form,
          messages,
          userMessage: text,
        }),
      });
      setStep(res.step);
      setMessages(res.messages);
      syncForm(res.form);
      setPendingDiff(res.pendingDiff);
      if (res.handoff) onHandoff?.(res.handoff, res.form);
      if (
        res.step === "ready" &&
        /Creating your draft event|Opening Agenda Ingest/i.test(res.assistantMessage)
      ) {
        onCompleteReady?.(res.form);
      }    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDiff() {
    if (!pendingDiff || !eventId) {
      // Create mode: fold into form only (applied on complete)
      if (pendingDiff) {
        syncForm({ ...form, featureOverrides: pendingDiff.proposedOverrides });
        setPendingDiff(null);
        onFeaturesApplied?.(pendingDiff.proposedOverrides);
      }
      return;
    }
    setConfirming(true);
    setError(null);
    try {
      const res = await apiFetch<{ overrides: SetupCopilotFormState["featureOverrides"] }>(
        "/ai/setup-copilot/confirm-features",
        {
          method: "POST",
          body: JSON.stringify({
            eventId,
            overrides: pendingDiff.proposedOverrides,
            summary: pendingDiff.summary,
          }),
        },
      );
      syncForm({ ...form, featureOverrides: res.overrides });
      setPendingDiff(null);
      onFeaturesApplied?.(res.overrides);
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "Changes applied. Attendees will see the updated features.", aiGenerated: true },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply features");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div
      className="setup-copilot-chat"
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: compact ? 280 : 420,
        border: "1px solid var(--border, #D9E1EE)",
        borderRadius: 8,
        background: "var(--surface, #fff)",
      }}
    >
      <div
        style={{
          padding: "10px 12px",
          borderBottom: "1px solid var(--border, #D9E1EE)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <strong style={{ fontSize: 14 }}>{mode === "settings" ? "Features assistant" : "Setup with AI"}</strong>
        <AiGeneratedChip />
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: 12, display: "grid", gap: 10 }}>
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              justifySelf: m.role === "user" ? "end" : "start",
              maxWidth: "92%",
              padding: "8px 10px",
              borderRadius: 8,
              background: m.role === "user" ? "var(--primary-100, #E5EBF7)" : "var(--surface-alt, #F3F6FB)",
              whiteSpace: "pre-wrap",
              fontSize: 14,
              lineHeight: 1.45,
            }}
          >
            {m.content}
          </div>
        ))}
        {pendingDiff ? (
          <ConfigDiffCardView
            card={pendingDiff}
            confirming={confirming}
            onConfirm={() => void confirmDiff()}
            onDismiss={() => setPendingDiff(null)}
          />
        ) : null}
        <div ref={bottomRef} />
      </div>
      {error ? (
        <p style={{ color: "var(--danger-700)", margin: "0 12px 8px", fontSize: 13 }}>{error}</p>
      ) : null}
      <form
        style={{ display: "flex", gap: 8, padding: 12, borderTop: "1px solid var(--border, #D9E1EE)" }}
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          className="input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a short answer…"
          disabled={busy}
          aria-label="Message the setup assistant"
          style={{ flex: 1 }}
        />
        <button className="button" type="submit" disabled={busy || !input.trim()}>
          {busy ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}
