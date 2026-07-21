import { useCallback, useEffect, useRef, useState } from "react";
import type { ConciergeActionCard, ConciergeHandoffStub, ConciergeMapHint } from "@event-app/shared";
import { CONCIERGE_STARTER_CHIPS } from "@event-app/shared";
import { apiFetch } from "../lib/api";
import { AiGeneratedChip } from "./AiGeneratedChip";

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  body: string;
  aiGenerated?: boolean;
  actionCards?: ConciergeActionCard[];
};

type TurnResponse = {
  conversationId: string;
  assistantMessage: string;
  aiGenerated: true;
  actionCards: ConciergeActionCard[];
  mapHint: ConciergeMapHint | null;
  handoff: ConciergeHandoffStub | null;
  refused: boolean;
  teaser?: { kind: string; message: string } | null;
};

type Props = {
  eventId: string;
  enabled: boolean;
  onMapHint?: (hint: ConciergeMapHint) => void;
};

export function ConciergeChat({ eventId, enabled, onMapHint }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [teaser, setTeaser] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);

  const headers = useCallback(
    () => ({ headers: { "x-event-id": eventId } }) as RequestInit,
    [eventId],
  );

  useEffect(() => {
    if (!open || !enabled || loaded.current) return;
    loaded.current = true;
    void (async () => {
      try {
        const hist = await apiFetch<{
          messages: Array<{
            id: string;
            role: string;
            body: string;
            aiGenerated: boolean;
          }>;
        }>("/ai/concierge/history", headers());
        setMessages(
          hist.messages.map((m) => ({
            id: m.id,
            role: m.role as ChatMessage["role"],
            body: m.body,
            aiGenerated: m.aiGenerated,
          })),
        );
      } catch {
        /* empty history is fine */
      }
    })();
  }, [open, enabled, headers]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    setTeaser(null);
    setInput("");
    const tempId = `local-${Date.now()}`;
    setMessages((prev) => [...prev, { id: tempId, role: "user", body: trimmed }]);
    try {
      const res = await apiFetch<TurnResponse>("/ai/concierge/turn", {
        method: "POST",
        body: JSON.stringify({ message: trimmed }),
        ...headers(),
      });
      if (res.mapHint && onMapHint) onMapHint(res.mapHint);
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          body: res.assistantMessage,
          aiGenerated: true,
          actionCards: res.actionCards,
        },
      ]);
    } catch (err) {
      const e = err as Error & { status?: number };
      const msg = e.message || "Concierge unavailable";
      if (e.status === 402 || /allowance|upgrade|limit/i.test(msg)) {
        setTeaser(msg);
        setMessages((prev) => [
          ...prev,
          {
            id: `teaser-${Date.now()}`,
            role: "assistant",
            body: msg,
            aiGenerated: true,
          },
        ]);
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmCard(card: ConciergeActionCard) {
    setConfirmingId(card.pendingActionId);
    setError(null);
    try {
      const res = await apiFetch<{ result: { summary: string } }>("/ai/concierge/confirm", {
        method: "POST",
        body: JSON.stringify({ pendingActionId: card.pendingActionId }),
        ...headers(),
      });
      setMessages((prev) => [
        ...prev,
        {
          id: `ok-${Date.now()}`,
          role: "assistant",
          body: res.result.summary,
          aiGenerated: false,
        },
      ]);
      setMessages((prev) =>
        prev.map((m) =>
          m.actionCards
            ? {
                ...m,
                actionCards: m.actionCards.filter((c) => c.pendingActionId !== card.pendingActionId),
              }
            : m,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not confirm");
    } finally {
      setConfirmingId(null);
    }
  }

  if (!enabled) return null;

  return (
    <>
      <button
        type="button"
        className="concierge-fab"
        aria-label="Open Concierge"
        onClick={() => setOpen(true)}
      >
        <span className="concierge-fab-icon" aria-hidden>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </span>
        <span className="concierge-fab-label">Concierge</span>
      </button>

      {open ? (
        <div className="concierge-sheet-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div
            className="concierge-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="concierge-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="concierge-sheet-header">
              <div>
                <h2 id="concierge-title" className="text-display-sm" style={{ margin: 0 }}>
                  Concierge
                </h2>
                <p className="help-text" style={{ margin: "4px 0 0" }}>
                  Schedule, agenda, maps, and FAQ for this event.
                </p>
              </div>
              <button type="button" className="button secondary" onClick={() => setOpen(false)}>
                Close
              </button>
            </header>

            <div className="concierge-chip-row">
              {CONCIERGE_STARTER_CHIPS.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  className="concierge-chip"
                  disabled={busy}
                  onClick={() => {
                    if (chip.id === "topic") {
                      setInput("Build me a schedule around ");
                      return;
                    }
                    void send(chip.label);
                  }}
                >
                  {chip.label}
                  {"handoff" in chip && chip.handoff ? (
                    <span className="concierge-chip-meta">Soon</span>
                  ) : null}
                </button>
              ))}
            </div>

            {teaser ? (
              <div className="concierge-teaser" role="status">
                <strong>Free teaser</strong>
                <p style={{ margin: "6px 0 0" }}>{teaser}</p>
                <a href="/pricing" className="button secondary" style={{ marginTop: 10, display: "inline-block" }}>
                  See plans
                </a>
              </div>
            ) : null}

            <div className="concierge-messages">
              {messages.length === 0 ? (
                <p className="help-text">Ask what’s on this morning, or pick a starter above.</p>
              ) : null}
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`concierge-msg concierge-msg-${m.role}`}
                >
                  {m.aiGenerated ? (
                    <div style={{ marginBottom: 4 }}>
                      <AiGeneratedChip />
                    </div>
                  ) : null}
                  <div className="concierge-msg-body">{m.body}</div>
                  {m.actionCards?.map((card) => (
                    <div key={card.pendingActionId} className="concierge-action-card">
                      <strong>{card.preview.title}</strong>
                      <p style={{ margin: "6px 0" }}>{card.preview.body}</p>
                      {card.preview.capacityNote ? (
                        <p className="help-text">{card.preview.capacityNote}</p>
                      ) : null}
                      {card.preview.overlaps?.length ? (
                        <ul className="help-text">
                          {card.preview.overlaps.map((o) => (
                            <li key={o.sessionId}>Overlaps: {o.title}</li>
                          ))}
                        </ul>
                      ) : null}
                      <button
                        type="button"
                        className="button"
                        disabled={confirmingId === card.pendingActionId}
                        onClick={() => void confirmCard(card)}
                      >
                        {confirmingId === card.pendingActionId ? "Working…" : "Confirm"}
                      </button>
                    </div>
                  ))}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {error ? <p className="form-error">{error}</p> : null}

            <form
              className="concierge-composer"
              onSubmit={(e) => {
                e.preventDefault();
                void send(input);
              }}
            >
              <input
                className="input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about this event…"
                disabled={busy}
                aria-label="Message Concierge"
              />
              <button type="submit" className="button" disabled={busy || !input.trim()}>
                Send
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
