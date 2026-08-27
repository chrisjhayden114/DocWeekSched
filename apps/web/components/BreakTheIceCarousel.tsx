import { useMemo, useRef, useState } from "react";
import { AutoGrowTextarea } from "./kit/AutoGrowTextarea";
import { Portal } from "./kit/Portal";
import { apiFetch } from "../lib/api";
import { MAX_BREAK_THE_ICE, personalizeOpener } from "../lib/breakTheIce";

type Person = { id: string; name: string; affiliation?: string | null; photoUrl?: string | null };

type Props = {
  people: Person[]; // parent excludes self
  token: string;
  withEventHeaders: (extra?: RequestInit) => RequestInit;
  eventName: string;
  onOpenDm: (person: Person) => void; // single-click → parent opens prefilled composer
};

/**
 * G4 — "Break the ice": a people-discovery strip for the ICEBREAKER channel.
 * Single click opens a prefilled DM (parent-owned); "Select multiple" sends a
 * personalized opener to up to MAX_BREAK_THE_ICE people after an explicit
 * confirm. Reuses the existing /conversations/direct + messages endpoints —
 * recipients who don't allow DMs are quietly skipped, never errored at.
 */
export function BreakTheIceCarousel({ people, token, withEventHeaders, eventName, onOpenDm }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [multi, setMulti] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [opener, setOpener] = useState(
    `Hi {name} — I'm at ${eventName} too and wanted to say hello. What brought you here?`,
  );
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const nameById = useMemo(() => Object.fromEntries(people.map((p) => [p.id, p.name])), [people]);
  const selectedPeople = people.filter((p) => selected.includes(p.id));
  if (people.length === 0) return null;

  const scroll = (dir: -1 | 1) => trackRef.current?.scrollBy({ left: dir * 320, behavior: "smooth" });
  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= MAX_BREAK_THE_ICE ? prev : [...prev, id],
    );

  async function sendToSelected() {
    setSending(true);
    setResult(null);
    let sent = 0;
    const skipped: string[] = [];
    for (const id of selected.slice(0, MAX_BREAK_THE_ICE)) {
      try {
        const convo = await apiFetch<{ id: string }>(
          "/conversations/direct",
          withEventHeaders({ method: "POST", body: JSON.stringify({ userId: id }) }),
          token,
        );
        await apiFetch(
          `/conversations/${convo.id}/messages`,
          withEventHeaders({ method: "POST", body: JSON.stringify({ body: personalizeOpener(opener, nameById[id] || "there") }) }),
          token,
        );
        sent++;
      } catch {
        skipped.push(nameById[id] || "someone");
      }
    }
    setSending(false);
    setResult(
      `Sent to ${sent} ${sent === 1 ? "person" : "people"}.` +
        (skipped.length ? ` ${skipped.length} couldn't be reached (they may not allow messages).` : ""),
    );
    setSelected([]);
    setConfirmOpen(false);
    setMulti(false);
  }

  return (
    <div className="card break-ice">
      <div className="break-ice-head">
        <div>
          <h3 className="break-ice-title">Break the ice</h3>
          <p className="help-text" style={{ margin: 0 }}>
            Say hello to people at this event with a ready-made opener — it&apos;s just a nudge, never automatic.
          </p>
        </div>
        <button type="button" className="button ghost" onClick={() => { setMulti((m) => !m); setSelected([]); }}>
          {multi ? "Done" : "Select multiple"}
        </button>
      </div>

      <div className="break-ice-carousel">
        <button type="button" className="break-ice-nav break-ice-prev" aria-label="Scroll left" onClick={() => scroll(-1)}>‹</button>
        <div className="break-ice-track" ref={trackRef}>
          {people.map((p) => {
            const on = selected.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                className={`break-ice-card${on ? " is-selected" : ""}`}
                aria-pressed={multi ? on : undefined}
                onClick={() => (multi ? toggle(p.id) : onOpenDm(p))}
              >
                {p.photoUrl ? (
                  <img className="break-ice-avatar" src={p.photoUrl} alt="" loading="lazy" />
                ) : (
                  <span className="break-ice-avatar break-ice-avatar--ph" aria-hidden>{(p.name[0] || "?").toUpperCase()}</span>
                )}
                <span className="break-ice-name">{p.name}</span>
                {p.affiliation ? <span className="break-ice-aff">{p.affiliation}</span> : null}
                {multi && on ? <span className="break-ice-check" aria-hidden>✓</span> : null}
                {!multi ? <span className="break-ice-cta">Break the ice</span> : null}
              </button>
            );
          })}
        </div>
        <button type="button" className="break-ice-nav break-ice-next" aria-label="Scroll right" onClick={() => scroll(1)}>›</button>
      </div>

      {multi && selected.length > 0 ? (
        <div className="break-ice-actionbar">
          <span className="help-text" style={{ margin: 0 }}>
            {selected.length} selected
            {selected.length >= MAX_BREAK_THE_ICE ? ` — that's the max (${MAX_BREAK_THE_ICE})` : ""}
          </span>
          <button type="button" className="button" onClick={() => setConfirmOpen(true)}>
            Send a hello to {selected.length} {selected.length === 1 ? "person" : "people"}…
          </button>
        </div>
      ) : null}

      {result ? (
        <p className="help-text break-ice-result" role="status">
          {result}
        </p>
      ) : null}

      {confirmOpen ? (
        <Portal>
          <div
            className="modal-backdrop"
            role="presentation"
            onClick={() => {
              if (!sending) setConfirmOpen(false);
            }}
          >
            <div
              className="modal-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="break-ice-confirm-title"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id="break-ice-confirm-title" className="text-display-sm" style={{ margin: "0 0 var(--space-3)" }}>
                Send your opener?
              </h2>
              <p className="text-body-md" style={{ margin: 0, color: "var(--ink-secondary)" }}>
                One direct message each to:
              </p>
              <div className="break-ice-chips">
                {selectedPeople.map((p) => (
                  <span key={p.id} className="chip">
                    {p.name}
                  </span>
                ))}
              </div>
              <label className="help-text" style={{ margin: "0 0 var(--space-4)", display: "grid", gap: 6 }}>
                Your opener — <code>{"{name}"}</code> becomes each person&apos;s name
                <AutoGrowTextarea
                  className="textarea"
                  minRows={3}
                  value={opener}
                  onChange={(e) => setOpener(e.target.value)}
                  disabled={sending}
                />
              </label>
              {selectedPeople[0] ? (
                <p className="help-text" style={{ margin: "0 0 var(--space-5)" }}>
                  Preview for {selectedPeople[0].name}: “{personalizeOpener(opener, selectedPeople[0].name)}”
                </p>
              ) : null}
              <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end", flexWrap: "wrap" }}>
                <button type="button" className="button secondary" disabled={sending} onClick={() => setConfirmOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={sending || !opener.trim() || selected.length === 0}
                  onClick={() => void sendToSelected()}
                >
                  {sending
                    ? "Sending…"
                    : `Send to ${selected.length} ${selected.length === 1 ? "person" : "people"}`}
                </button>
              </div>
            </div>
          </div>
        </Portal>
      ) : null}
    </div>
  );
}
