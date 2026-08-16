import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type {
  ConciergeActionCard,
  ConciergeHandoffStub,
  ConciergeLink,
  ConciergeMapHint,
} from "@event-app/shared";
import { ASSISTANT_COPY, CONCIERGE_STARTER_CHIPS } from "@event-app/shared";
import { apiFetch } from "../lib/api";
import { isInternalHref, splitByLinks, unmatchedLinks } from "../lib/chatLinks";
import { AiAnswerChip } from "./AiAnswerChip";
import { AssistantMark } from "./AssistantMark";

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  body: string;
  aiGenerated?: boolean;
  actionCards?: ConciergeActionCard[];
  links?: ConciergeLink[];
};

type TurnResponse = {
  conversationId: string;
  assistantMessage: string;
  aiGenerated: true;
  actionCards: ConciergeActionCard[];
  mapHint: ConciergeMapHint | null;
  handoff: ConciergeHandoffStub | null;
  links?: ConciergeLink[];
  refused: boolean;
  teaser?: { kind: string; message: string } | null;
};

/** E19.3 — the attendee assistant's name comes from the copy layer. */
const ATTENDEE_ASSISTANT = ASSISTANT_COPY.attendee;

const DESKTOP_MQ = "(min-width: 1024px)";
const OPEN_STORAGE_KEY = "conciergeOpen";

/** Default starter labels (organizers can override up to 3 via meta). */
const DEFAULT_STARTERS = CONCIERGE_STARTER_CHIPS.map((c) => c.label);
/** The one default starter that prefills the composer instead of sending. */
const TOPIC_PREFILL_LABEL = CONCIERGE_STARTER_CHIPS.find((c) => c.id === "topic")?.label;

/**
 * CHAT-2 — assistant body with the server's deterministic links rendered
 * inline where their labels appear; whatever didn't match stays as chips.
 */
function AssistantBody({ body, links }: { body: string; links?: ConciergeLink[] }) {
  const segments = splitByLinks(body, links ?? []);
  const leftover = unmatchedLinks(segments, links ?? []);
  return (
    <>
      <div className="concierge-msg-body">
        {segments.map((seg, i) =>
          seg.type === "link" ? (
            <Link key={`${seg.href}-${i}`} href={seg.href} className="concierge-inline-link">
              {seg.text}
            </Link>
          ) : (
            <span key={i}>{seg.text}</span>
          ),
        )}
      </div>
      {leftover.length ? (
        <div
          className="concierge-links"
          style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}
        >
          {leftover.map((link) =>
            isInternalHref(link.href) ? (
              <Link key={link.href} href={link.href} className="button secondary">
                {link.label}
              </Link>
            ) : (
              <a key={link.href} href={link.href} className="button secondary">
                {link.label}
              </a>
            ),
          )}
        </div>
      ) : null}
    </>
  );
}

type Props = {
  eventId: string;
  enabled: boolean;
  onMapHint?: (hint: ConciergeMapHint) => void;
};

export function ConciergeChat({ eventId, enabled, onMapHint }: Props) {
  const [open, setOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  /** B3 — organizer-configured starter questions (defaults until meta loads). */
  const [starters, setStarters] = useState<string[]>(DEFAULT_STARTERS);
  const bottomRef = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);

  const headers = useCallback(
    () => ({ headers: { "x-event-id": eventId } }) as RequestInit,
    [eventId],
  );

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_MQ);
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(OPEN_STORAGE_KEY) === "1") setOpen(true);
    } catch {
      /* private mode / blocked storage */
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(OPEN_STORAGE_KEY, open ? "1" : "0");
    } catch {
      /* private mode / blocked storage */
    }
  }, [open]);

  useEffect(() => {
    if (!open || !isDesktop) {
      document.body.classList.remove("concierge-docked");
      return;
    }
    document.body.classList.add("concierge-docked");
    return () => document.body.classList.remove("concierge-docked");
  }, [open, isDesktop]);

  useEffect(() => {
    if (!open || !enabled || loaded.current) return;
    loaded.current = true;
    void (async () => {
      try {
        const meta = await apiFetch<{ starters?: string[] }>("/ai/concierge/meta", headers());
        if (Array.isArray(meta.starters) && meta.starters.length) {
          setStarters(meta.starters.slice(0, 3));
        }
      } catch {
        /* defaults are fine */
      }
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
          links: res.links,
        },
      ]);
    } catch (err) {
      const e = err as Error & { status?: number };
      const msg = e.message || `${ATTENDEE_ASSISTANT.name} unavailable`;
      if (e.status === 402 || /allowance|upgrade|limit/i.test(msg)) {
        // F0.1 — allowance limits are stated plainly in the thread; attendees
        // can't buy plans, so no pricing upsell here (anti-goal: dark patterns).
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

  const chatBody = (
    <>
      <header className="concierge-sheet-header">
        <div>
          <h2
            id="concierge-title"
            className="text-display-sm"
            style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}
          >
            <span className="concierge-header-mark" aria-hidden>
              <AssistantMark size={20} />
            </span>
            {ATTENDEE_ASSISTANT.name}
          </h2>
          <p className="help-text" style={{ margin: "4px 0 0" }}>
            {ATTENDEE_ASSISTANT.description}
          </p>
        </div>
        <button type="button" className="button secondary" onClick={() => setOpen(false)}>
          Close
        </button>
      </header>

      {/* B2 — starters only greet an empty conversation; once chatting they
          disappear (they return if history is ever cleared). */}
      {messages.length === 0 ? (
        <div className="concierge-chip-row">
          {starters.map((label, i) => (
            <button
              key={`${i}-${label}`}
              type="button"
              className="concierge-chip"
              disabled={busy}
              onClick={() => {
                if (TOPIC_PREFILL_LABEL && label === TOPIC_PREFILL_LABEL) {
                  setInput("Build me a schedule around ");
                  return;
                }
                void send(label);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="concierge-messages">
        {messages.length === 0 ? (
          <p className="help-text">Ask what’s on this morning, or pick a starter above.</p>
        ) : null}
        {messages.map((m) => (
          <div key={m.id} className={`concierge-msg concierge-msg-${m.role}`}>
            {m.aiGenerated ? (
              <div style={{ marginBottom: 4 }}>
                <AiAnswerChip />
              </div>
            ) : null}
            {m.role === "assistant" ? (
              <AssistantBody body={m.body} links={m.links} />
            ) : (
              <div className="concierge-msg-body">{m.body}</div>
            )}
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
          aria-label={`Message ${ATTENDEE_ASSISTANT.name}`}
        />
        <button type="submit" className="button" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </>
  );

  const showFab = !open || !isDesktop;

  return (
    <>
      {showFab ? (
        <button
          type="button"
          className="concierge-fab"
          aria-label={`Open ${ATTENDEE_ASSISTANT.name}`}
          onClick={() => setOpen(true)}
        >
          <span className="concierge-fab-icon" aria-hidden>
            <AssistantMark size={18} />
          </span>
          <span className="concierge-fab-label">{ATTENDEE_ASSISTANT.name}</span>
        </button>
      ) : null}

      {open && isDesktop ? (
        <aside
          aria-label="Event assistant"
          className="concierge-panel"
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
        >
          {chatBody}
        </aside>
      ) : null}

      {open && !isDesktop ? (
        <div className="concierge-sheet-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div
            className="concierge-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="concierge-title"
            onClick={(e) => e.stopPropagation()}
          >
            {chatBody}
          </div>
        </div>
      ) : null}
    </>
  );
}
