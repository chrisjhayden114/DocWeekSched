import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AiGeneratedChip } from "./AiGeneratedChip";
import { ListEmpty, ListError } from "./ListState";
import { opsActionLabel, opsDetectorLabel } from "../lib/opsLabels";
import { organizerFetch } from "../lib/organizerApi";

type OpsCard = {
  id: string;
  detectorKind: string;
  triggerInstanceKey: string;
  status: string;
  triggerSummary: string;
  evidence: Record<string, unknown>;
  draftActionType: string;
  draftTitle: string;
  draftBody: string;
  draftPayload: Record<string, unknown>;
  createdAt: string;
};

type InboxResponse = {
  active: boolean;
  window: { openAt: string; closeAt: string };
  communityBlocklist: unknown;
  cards: OpsCard[];
};

function evidenceLinks(evidence: Record<string, unknown>): { label: string; href: string }[] {
  const links = evidence.links;
  if (!Array.isArray(links)) return [];
  return links.filter(
    (l): l is { label: string; href: string } =>
      !!l && typeof l === "object" && typeof (l as { label?: unknown }).label === "string" && typeof (l as { href?: unknown }).href === "string",
  );
}

export function OpsInboxPanel({ eventId }: { eventId: string }) {
  const [data, setData] = useState<InboxResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [blocklistText, setBlocklistText] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await organizerFetch<InboxResponse>("/ai/ops/inbox?status=OPEN", eventId);
      setData(res);
      const list = Array.isArray(res.communityBlocklist)
        ? (res.communityBlocklist as string[]).join(", ")
        : "";
      setBlocklistText(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load Ops Inbox");
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const windowLabel = useMemo(() => {
    if (!data) return "";
    return `${new Date(data.window.openAt).toLocaleString()} → ${new Date(data.window.closeAt).toLocaleString()}`;
  }, [data]);

  async function runDetectors() {
    setBusy(true);
    setError(null);
    try {
      await organizerFetch("/ai/ops/inbox/run-detectors?sync=1", eventId, {
        method: "POST",
        body: JSON.stringify({ sync: true }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Detector run failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveBlocklist(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const communityBlocklist = blocklistText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      await organizerFetch("/ai/ops/inbox/blocklist", eventId, {
        method: "PATCH",
        body: JSON.stringify({ communityBlocklist }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Blocklist save failed");
    } finally {
      setBusy(false);
    }
  }

  async function dismiss(cardId: string) {
    setBusy(true);
    try {
      await organizerFetch(`/ai/ops/inbox/${cardId}/dismiss`, eventId, { method: "POST", body: "{}" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dismiss failed");
    } finally {
      setBusy(false);
    }
  }

  async function apply(cardId: string) {
    setBusy(true);
    try {
      await organizerFetch(`/ai/ops/inbox/${cardId}/apply`, eventId, { method: "POST", body: "{}" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Apply failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(cardId: string) {
    setBusy(true);
    try {
      await organizerFetch(`/ai/ops/inbox/${cardId}`, eventId, {
        method: "PATCH",
        body: JSON.stringify({ draftTitle: editTitle, draftBody: editBody }),
      });
      setEditingId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Edit failed");
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return error ? <ListError message={error} onRetry={() => void load()} /> : <p className="help-text">Loading Ops Inbox…</p>;
  }

  // E16.4: a first-time organizer must be able to read this and say what the
  // Ops Inbox is for. Same intro on the inactive and active states.
  const intro = (
    <p className="help-text" style={{ marginTop: 0 }}>
      During your event, detectors watch for things worth acting on — a daily digest to send, questions going
      unanswered, sessions filling up, schedule changes — and draft a suggested message or action for each.
      Nothing is ever sent to attendees until you review it and click Send/Apply. “Run detectors” checks for
      new suggestions right now instead of waiting for the scheduled sweep.
    </p>
  );

  if (!data.active) {
    return (
      <section className="console-panel">
        <div className="console-panel-head">
          <p className="console-panel-label">Ops Inbox</p>
          <AiGeneratedChip />
        </div>
        {intro}
        <p className="help-text" style={{ marginTop: 0 }}>
          Active from 48 hours before the event starts through 24 hours after it ends ({windowLabel}).
        </p>
        {error ? <ListError message={error} /> : null}
      </section>
    );
  }

  return (
    <section className="console-panel">
      <div className="console-panel-head">
        <p className="console-panel-label">Ops Inbox</p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <AiGeneratedChip />
          <button type="button" className="button secondary" disabled={busy} onClick={() => void runDetectors()}>
            Run detectors
          </button>
        </div>
      </div>
      {intro}
      <p className="help-text" style={{ marginTop: 0 }}>
        Active window: {windowLabel}.
      </p>
      {error ? <ListError message={error} /> : null}

      {data.cards.length === 0 ? (
        <ListEmpty
          title="No open cards"
          body="Run detectors or wait for the scheduled sweep."
          actionLabel="Run detectors"
          onAction={() => void runDetectors()}
        />
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
          {data.cards.map((card) => {
            const links = evidenceLinks(card.evidence || {});
            const editing = editingId === card.id;
            return (
              <li
                key={card.id}
                style={{
                  border: "1px solid var(--gray-200)",
                  borderRadius: "var(--radius-sm)",
                  padding: 14,
                  background: "#fff",
                }}
              >
                <p style={{ margin: "0 0 4px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }} className="text-meta">
                  <strong style={{ color: "var(--gray-700)" }}>{opsDetectorLabel(card.detectorKind)}</strong>
                  <span className="chip">{opsActionLabel(card.draftActionType)}</span>
                </p>
                <h3 style={{ margin: "0 0 8px", fontSize: 18 }}>{card.triggerSummary}</h3>
                {links.length > 0 ? (
                  <p style={{ margin: "0 0 8px" }}>
                    {links.map((l) => (
                      <a key={l.href} href={l.href} style={{ marginRight: 12 }}>
                        {l.label}
                      </a>
                    ))}
                  </p>
                ) : null}
                {editing ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <input className="input" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                    <textarea
                      className="textarea"
                      rows={5}
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                    />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button type="button" className="button" disabled={busy} onClick={() => void saveEdit(card.id)}>
                        Save draft
                      </button>
                      <button type="button" className="button secondary" onClick={() => setEditingId(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p style={{ margin: "0 0 4px", fontWeight: 700 }}>{card.draftTitle}</p>
                    <p style={{ margin: "0 0 12px", whiteSpace: "pre-wrap" }}>{card.draftBody}</p>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" className="button" disabled={busy} onClick={() => void apply(card.id)}>
                        Send / Apply
                      </button>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={busy}
                        onClick={() => {
                          setEditingId(card.id);
                          setEditTitle(card.draftTitle);
                          setEditBody(card.draftBody);
                        }}
                      >
                        Edit
                      </button>
                      <button type="button" className="button secondary" disabled={busy} onClick={() => void dismiss(card.id)}>
                        Dismiss
                      </button>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* E16.4: the blocklist is a setting, not an inbox item — kept out of
          the card flow behind a disclosure. */}
      <details style={{ marginTop: 16 }}>
        <summary style={{ cursor: "pointer", font: "var(--text-label)", color: "var(--gray-700)" }}>
          Community blocklist settings
        </summary>
        <form onSubmit={(e) => void saveBlocklist(e)} className="console-form" style={{ marginTop: 8 }}>
          <label>
            Blocked words or phrases (comma-separated)
            <input
              className="input"
              value={blocklistText}
              onChange={(e) => setBlocklistText(e.target.value)}
              placeholder="spam, phishing"
            />
            <span className="help-text">
              Community posts containing these are flagged for the Moderation detector.
            </span>
          </label>
          <button type="submit" className="button secondary" disabled={busy} style={{ justifySelf: "start" }}>
            Save blocklist
          </button>
        </form>
      </details>
    </section>
  );
}
