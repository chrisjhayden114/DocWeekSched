import { FormEvent, useEffect, useState, type KeyboardEvent } from "react";
import { organizerFetch } from "../../lib/organizerApi";

const MAX_LABELS = 20;
const MAX_CHARS = 40;

type EventFields = {
  name: string;
  timezone: string;
  startDate: string;
  endDate: string;
};

type Props = {
  eventId: string;
  event: EventFields;
  labels: string[];
  onSaved: (next: string[]) => void;
};

/**
 * PART-1 — chip input for organizer-defined participant labels.
 * Saves through PUT /event (required identity fields + participantLabels).
 */
export function ParticipantLabelsEditor({ eventId, event, labels, onSaved }: Props) {
  const [draft, setDraft] = useState<string[]>(labels);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setDraft(labels);
  }, [labels]);

  function addLabel(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (trimmed.length > MAX_CHARS) {
      setError(`Each label must be 1–${MAX_CHARS} characters`);
      return;
    }
    if (draft.some((l) => l.toLowerCase() === trimmed.toLowerCase())) {
      setError("That label is already on the list");
      return;
    }
    if (draft.length >= MAX_LABELS) {
      setError(`At most ${MAX_LABELS} labels`);
      return;
    }
    setDraft((prev) => [...prev, trimmed]);
    setInput("");
    setError(null);
    setNotice(null);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      addLabel(input);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await organizerFetch<{ participantLabels?: string[] }>("/event/", eventId, {
        method: "PUT",
        body: JSON.stringify({
          name: event.name,
          timezone: event.timezone,
          startDate: event.startDate,
          endDate: event.endDate,
          participantLabels: draft,
        }),
      });
      const next = res.participantLabels ?? draft;
      setDraft(next);
      onSaved(next);
      setNotice(next.length ? "Participant labels saved." : "Participant labels cleared.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save labels");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="console-panel">
      <p className="console-panel-label">Participant labels</p>
      <p className="help-text" style={{ marginTop: 0 }}>
        Define labels that fit your event — departments, cohorts, roles. Attendees pick one; you can
        override.
      </p>
      <p className="help-text" style={{ marginTop: 0 }}>
        Removing a label clears it from anyone who had picked it.
      </p>
      {error ? (
        <p role="alert" style={{ color: "var(--danger)", marginTop: 0 }}>
          {error}
        </p>
      ) : null}
      {notice ? <p className="help-text">{notice}</p> : null}
      <form onSubmit={(ev) => void save(ev)} style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {draft.map((label) => (
            <span key={label} className="chip" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {label}
              <button
                type="button"
                className="button ghost"
                style={{ padding: "0 4px", minHeight: 0, lineHeight: 1 }}
                aria-label={`Remove ${label}`}
                disabled={busy}
                onClick={() => {
                  setDraft((prev) => prev.filter((l) => l !== label));
                  setNotice(null);
                }}
              >
                ×
              </button>
            </span>
          ))}
          {draft.length === 0 ? <span className="help-text">No labels yet.</span> : null}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            className="input"
            value={input}
            maxLength={MAX_CHARS}
            placeholder="Add a label"
            aria-label="Add a participant label"
            disabled={busy || draft.length >= MAX_LABELS}
            onChange={(ev) => setInput(ev.target.value)}
            onKeyDown={onKeyDown}
            style={{ maxWidth: 260 }}
          />
          <button
            type="button"
            className="button secondary"
            disabled={busy || !input.trim() || draft.length >= MAX_LABELS}
            onClick={() => addLabel(input)}
          >
            Add
          </button>
          <button type="submit" className="button" disabled={busy}>
            {busy ? "Saving…" : "Save labels"}
          </button>
        </div>
      </form>
    </div>
  );
}
