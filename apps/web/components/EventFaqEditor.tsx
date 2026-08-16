import { FormEvent, useCallback, useEffect, useState } from "react";
import { ASSISTANT_COPY, CONCIERGE_STARTER_CHIPS } from "@event-app/shared";
import { organizerFetch } from "../lib/organizerApi";

const STARTER_DEFAULTS = CONCIERGE_STARTER_CHIPS.map((c) => c.label);

/**
 * CHAT-2 (B3) — the three optional starter questions the Event assistant
 * greets attendees with. Empty inputs = the built-in defaults (shown as
 * placeholders); saving an empty form clears the override.
 */
export function AssistantStartersEditor({ eventId }: { eventId: string }) {
  const [values, setValues] = useState<string[]>(["", "", ""]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const meta = await organizerFetch<{ starters?: string[] }>("/ai/concierge/meta", eventId);
        if (cancelled || !Array.isArray(meta.starters)) return;
        const isDefaults =
          meta.starters.length === STARTER_DEFAULTS.length &&
          meta.starters.every((s, i) => s === STARTER_DEFAULTS[i]);
        if (!isDefaults) {
          setValues([0, 1, 2].map((i) => meta.starters?.[i] ?? ""));
        }
      } catch {
        /* defaults stay as placeholders */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const starters = values.map((v) => v.trim()).filter((v) => v.length > 0);
      await organizerFetch("/ai/concierge/starters", eventId, {
        method: "PUT",
        body: JSON.stringify({ starters }),
      });
      setNotice(starters.length ? "Starter questions saved." : "Reset to the default starters.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ marginTop: 28 }}>
      <h3 style={{ marginTop: 0 }}>{ASSISTANT_COPY.attendee.name} starters</h3>
      <p className="help-text">
        Starter questions (optional — defaults shown as placeholders). Attendees see them as tappable
        chips when their conversation is empty.
      </p>
      {error ? <p className="form-error">{error}</p> : null}
      {notice ? <p className="help-text">{notice}</p> : null}
      <form className="grid" onSubmit={(e) => void save(e)} style={{ gap: 10, maxWidth: 560 }}>
        {values.map((value, i) => (
          <label key={i} className="field-label">
            <span className="field-label-text">Starter question {i + 1}</span>
            <input
              className="input"
              value={value}
              maxLength={80}
              placeholder={STARTER_DEFAULTS[i] ?? ""}
              onChange={(e) =>
                setValues((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))
              }
            />
          </label>
        ))}
        <button type="submit" className="button" disabled={busy}>
          {busy ? "Saving…" : "Save starters"}
        </button>
      </form>
    </section>
  );
}

type FaqRow = {
  id: string;
  question: string;
  answer: string;
  sortOrder: number;
};

export function EventFaqEditor({ eventId }: { eventId: string }) {
  const [rows, setRows] = useState<FaqRow[]>([]);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const data = await organizerFetch<FaqRow[]>("/event/faq", eventId);
    setRows(data);
  }, [eventId]);

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "Failed to load FAQ"));
  }, [load]);

  async function addFaq(e: FormEvent) {
    e.preventDefault();
    if (!question.trim() || !answer.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await organizerFetch("/event/faq", eventId, {
        method: "POST",
        body: JSON.stringify({ question: question.trim(), answer: answer.trim() }),
      });
      setQuestion("");
      setAnswer("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    try {
      await organizerFetch(`/event/faq/${id}`, eventId, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ marginTop: 28 }}>
      <h3 style={{ marginTop: 0 }}>{ASSISTANT_COPY.attendee.name} FAQ</h3>
      <p className="help-text">
        Answers the {ASSISTANT_COPY.attendee.name.toLowerCase()} can use when attendees ask about wifi, parking,
        registration, and other event specifics.
      </p>
      {error ? <p className="form-error">{error}</p> : null}
      <ul style={{ listStyle: "none", padding: 0, margin: "12px 0" }}>
        {rows.map((row) => (
          <li
            key={row.id}
            style={{
              padding: "12px 0",
              borderBottom: "1px solid var(--border, #d0d7e5)",
            }}
          >
            <strong>{row.question}</strong>
            <p style={{ margin: "6px 0 8px", whiteSpace: "pre-wrap" }}>{row.answer}</p>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => void remove(row.id)}
            >
              Remove
            </button>
          </li>
        ))}
        {rows.length === 0 ? <li className="help-text">No FAQ entries yet.</li> : null}
      </ul>
      <form className="grid" onSubmit={(e) => void addFaq(e)} style={{ gap: 10, maxWidth: 560 }}>
        <label className="field-label">
          <span className="field-label-text">Question</span>
          <input
            className="input"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="What’s the wifi password?"
            required
          />
        </label>
        <label className="field-label">
          <span className="field-label-text">Answer</span>
          <textarea
            className="input"
            rows={3}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Network: EventGuest · Password: …"
            required
          />
        </label>
        <button type="submit" className="button" disabled={busy}>
          {busy ? "Saving…" : "Add FAQ"}
        </button>
      </form>
    </section>
  );
}
