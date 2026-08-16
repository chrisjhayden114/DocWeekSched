import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type {
  ConciergeLink,
  ConfigDiffCard,
  SetupCopilotFormState,
  SetupCopilotMessage,
  SetupCopilotMode,
  SetupCopilotStep,
  SetupHandoffA1,
} from "@event-app/shared";
import { ASSISTANT_COPY, emptySetupFormState } from "@event-app/shared";
import { apiFetch } from "../lib/api";
import { splitByLinks } from "../lib/chatLinks";
import {
  copilotStepFromForm,
  hasKnownHandoffFields,
  seededOpeningMessage,
} from "../lib/setupCopilotDraft";
import { AiGeneratedChip } from "./AiGeneratedChip";
import { ConfigDiffCardView } from "./ConfigDiffCardView";
import { ConfirmDialog } from "./ConfirmDialog";

export type SetupCopilotChatProps = {
  mode: SetupCopilotMode;
  organizationId?: string;
  eventId?: string;
  /** Called whenever form state updates from the conversation. */
  onFormChange: (form: SetupCopilotFormState) => void;
  /** Initial form (e.g. preserved from a prior session). */
  initialForm?: Partial<SetupCopilotFormState>;
  /** Restored chat history. Non-empty skips /start. */
  initialHistory?: SetupCopilotMessage[];
  initialStep?: SetupCopilotStep;
  /** Wizard description, mentioned in the seeded opening if present. */
  initialDescription?: string;
  /** Fired whenever messages or step change so the parent can persist. */
  onConversationChange?: (state: { messages: SetupCopilotMessage[]; step: SetupCopilotStep }) => void;
  /**
   * When set, the header shows Start over. Called after the confirm dialog;
   * the parent clears both drafts and remounts this chat.
   */
  onStartOver?: () => void;
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
  links?: ConciergeLink[];
  aiGenerated: true;
  liveEvent?: boolean;
};

/**
 * AGENT-3 (CHAT-2 pattern) — assistant body with the server's deterministic
 * links rendered inline where their labels appear. splitByLinks only inlines
 * internal ("/…") hrefs; anything else stays plain text.
 */
function AssistantBody({ content, links }: { content: string; links?: ConciergeLink[] }) {
  const segments = splitByLinks(content, links ?? []);
  return (
    <>
      {segments.map((seg, i) =>
        seg.type === "link" ? (
          <Link key={`${seg.href}-${i}`} href={seg.href} style={{ textDecoration: "underline" }}>
            {seg.text}
          </Link>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

function defaultTimezone() {
  return typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" : "UTC";
}

export function SetupCopilotChat({
  mode,
  organizationId,
  eventId,
  onFormChange,
  initialForm,
  initialHistory,
  initialStep,
  initialDescription,
  onConversationChange,
  onStartOver,
  onHandoff,
  onCompleteReady,
  onFeaturesApplied,
  compact,
}: SetupCopilotChatProps) {
  const seededForm: SetupCopilotFormState = {
    ...emptySetupFormState(defaultTimezone()),
    ...initialForm,
  };
  const restoreHistory = Boolean(initialHistory && initialHistory.length > 0);
  const seedFromKnown =
    mode === "create" && !restoreHistory && hasKnownHandoffFields(seededForm, { description: initialDescription });

  const [step, setStep] = useState<SetupCopilotStep>(() => {
    if (mode === "settings") return "settings_chat";
    if (initialStep) return initialStep;
    if (restoreHistory || seedFromKnown) return copilotStepFromForm(seededForm);
    return "name";
  });
  const [form, setForm] = useState<SetupCopilotFormState>(() => seededForm);
  const [messages, setMessages] = useState<SetupCopilotMessage[]>(() => {
    if (restoreHistory) return initialHistory ?? [];
    if (seedFromKnown) {
      return [
        {
          role: "assistant",
          content: seededOpeningMessage(seededForm, { description: initialDescription }),
          aiGenerated: true,
        },
      ];
    }
    return [];
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDiff, setPendingDiff] = useState<ConfigDiffCard | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [startOverOpen, setStartOverOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const syncForm = useCallback(
    (next: SetupCopilotFormState) => {
      setForm(next);
      onFormChange(next);
    },
    [onFormChange],
  );

  const syncConversation = useCallback(
    (nextMessages: SetupCopilotMessage[], nextStep: SetupCopilotStep) => {
      setMessages(nextMessages);
      setStep(nextStep);
      onConversationChange?.({ messages: nextMessages, step: nextStep });
    },
    [onConversationChange],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (restoreHistory || seedFromKnown) {
      onFormChange(form);
      onConversationChange?.({ messages, step });
      return;
    }
    void (async () => {
      try {
        const tz = defaultTimezone();
        const q = new URLSearchParams({ mode, timezone: tz });
        if (eventId) q.set("eventId", eventId);
        const res = await apiFetch<{
          step: SetupCopilotStep;
          form: SetupCopilotFormState;
          messages: SetupCopilotMessage[];
        }>(`/ai/setup-copilot/start?${q}`);
        syncConversation(res.messages, res.step);
        syncForm({ ...res.form, ...initialForm });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not start assistant");
      }
    })();
    // Restore / seed paths are decided once from the initial props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, eventId]);

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
      syncConversation(res.messages, res.step);
      syncForm(res.form);
      setPendingDiff(res.pendingDiff);
      if (res.handoff) onHandoff?.(res.handoff, res.form);
      if (
        res.step === "ready" &&
        /Creating your draft event|Opening Agenda Ingest/i.test(res.assistantMessage)
      ) {
        onCompleteReady?.(res.form);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send");
    } finally {
      setBusy(false);
    }
  }

  async function uploadDocument(file: File | null) {
    if (!file || busy || uploading || mode !== "create") return;
    if (file.size > 20_000_000) {
      setError("File exceeds 20 MB limit");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const fileUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });
      const res = await apiFetch<TurnResponse>("/ai/setup-copilot/document", {
        method: "POST",
        body: JSON.stringify({
          fileUrl,
          fileName: file.name,
          mime: file.type || "application/octet-stream",
          organizationId,
          step,
          form,
          messages,
        }),
      });
      syncConversation(res.messages, res.step);
      syncForm(res.form);
      setPendingDiff(res.pendingDiff);
      if (res.handoff) onHandoff?.(res.handoff, res.form);
      if (
        res.step === "ready" &&
        /Creating your draft event|Opening Agenda Ingest/i.test(res.assistantMessage)
      ) {
        onCompleteReady?.(res.form);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
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
      const nextMessages: SetupCopilotMessage[] = [
        ...messages,
        { role: "assistant", content: "Changes applied. Attendees will see the updated features.", aiGenerated: true },
      ];
      syncConversation(nextMessages, step);
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
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--surface, #fff)",
      }}
    >
      <div
        style={{
          padding: "10px 12px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <strong style={{ fontSize: 14 }}>
          {/* E19.3 — one assistant, one name, whatever mode it runs in */}
          {ASSISTANT_COPY.organizer.name}
        </strong>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          {onStartOver ? (
            <button
              type="button"
              className="button ghost"
              style={{ padding: "2px 8px", fontSize: 13, fontWeight: 400, color: "var(--ink-secondary)" }}
              onClick={() => setStartOverOpen(true)}
            >
              Start over
            </button>
          ) : null}
          <AiGeneratedChip />
        </span>
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
              background: m.role === "user" ? "var(--event-accent-tint)" : "var(--surface-alt)",
              whiteSpace: "pre-wrap",
              fontSize: 14,
              lineHeight: 1.45,
            }}
          >
            {m.role === "assistant" ? <AssistantBody content={m.content} links={m.links} /> : m.content}
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
        style={{ display: "flex", gap: 8, padding: 12, borderTop: "1px solid var(--border)" }}
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {mode === "create" && organizationId ? (
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.xlsx,application/pdf,image/*"
              hidden
              onChange={(e) => void uploadDocument(e.target.files?.[0] || null)}
            />
            <button
              className="button"
              type="button"
              disabled={busy || uploading}
              aria-label="Upload a program document"
              title="Upload a program document"
              onClick={() => fileRef.current?.click()}
              style={{ padding: "0 10px" }}
            >
              {uploading ? "…" : "📎"}
            </button>
          </>
        ) : null}
        <input
          className="input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={uploading ? "Reading document…" : "Type a short answer…"}
          disabled={busy || uploading}
          aria-label={`Message ${ASSISTANT_COPY.organizer.name}`}
          style={{ flex: 1 }}
        />
        <button className="button" type="submit" disabled={busy || uploading || !input.trim()}>
          {busy || uploading ? "…" : "Send"}
        </button>
      </form>
      {onStartOver ? (
        <ConfirmDialog
          open={startOverOpen}
          title="Start over"
          body="Clears the conversation and everything entered in both modes."
          confirmLabel="Start over"
          onConfirm={() => {
            setStartOverOpen(false);
            onStartOver();
          }}
          onCancel={() => setStartOverOpen(false)}
        />
      ) : null}
    </div>
  );
}
