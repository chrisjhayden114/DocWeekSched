import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
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
    return <p className="help-text">{error || "Loading Ops Inbox…"}</p>;
  }

  if (!data.active) {
    return (
      <section style={{ display: "grid", gap: 12 }}>
        <h2 style={{ marginTop: 0 }}>Ops Inbox</h2>
        <p className="help-text">
          Active from 48 hours before the event starts through 24 hours after it ends ({windowLabel}).
        </p>
        {error ? <p style={{ color: "#b42318" }}>{error}</p> : null}
      </section>
    );
  }

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <h2 style={{ margin: 0, flex: 1 }}>Ops Inbox</h2>
        <button type="button" className="button secondary" disabled={busy} onClick={() => void runDetectors()}>
          Run detectors
        </button>
      </div>
      <p className="help-text">
        Review-and-send only — nothing is delivered until you click Send/Apply. Window: {windowLabel}.
      </p>
      {error ? <p style={{ color: "#b42318" }}>{error}</p> : null}

      <form onSubmit={(e) => void saveBlocklist(e)} style={{ display: "grid", gap: 8, maxWidth: 560 }}>
        <label>
          Community blocklist (comma-separated)
          <input
            className="input"
            value={blocklistText}
            onChange={(e) => setBlocklistText(e.target.value)}
            placeholder="spam, phishing"
          />
        </label>
        <button type="submit" className="button secondary" disabled={busy} style={{ justifySelf: "start" }}>
          Save blocklist
        </button>
      </form>

      {data.cards.length === 0 ? (
        <p className="help-text">No open cards. Run detectors or wait for the scheduled sweep.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 16 }}>
          {data.cards.map((card) => {
            const links = evidenceLinks(card.evidence || {});
            const editing = editingId === card.id;
            return (
              <li
                key={card.id}
                style={{
                  border: "1px solid var(--border, #D9E1EE)",
                  borderRadius: 8,
                  padding: 16,
                  background: "var(--surface, #fff)",
                }}
              >
                <p style={{ margin: "0 0 4px", fontSize: 12, color: "var(--ink-secondary, #41506D)" }}>
                  {card.detectorKind} · {card.draftActionType}
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
    </section>
  );
}
