import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiFetch } from "../lib/api";

type Slot = { id: string; startsAt: string; endsAt: string; sortOrder: number };
type MeetingRow = {
  id: string;
  status: "PENDING" | "ACCEPTED" | "DECLINED" | "CANCELLED";
  message: string | null;
  fromUserId: string;
  toUserId: string;
  fromUser: { id: string; name: string; photoUrl?: string | null };
  toUser: { id: string; name: string; photoUrl?: string | null };
  slots: Slot[];
  createdAt: string;
};

export function MeetingRequestsPanel({
  token,
  withEventHeaders,
  currentUserId,
}: {
  token: string;
  withEventHeaders: (extra?: RequestInit) => RequestInit;
  currentUserId: string;
}) {
  const [rows, setRows] = useState<MeetingRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await apiFetch<MeetingRow[]>("/meetings", withEventHeaders(), token);
      setRows(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load meetings");
    }
  }, [token, withEventHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingIncoming = rows.filter((r) => r.status === "PENDING" && r.toUserId === currentUserId);
  const pendingOutgoing = rows.filter((r) => r.status === "PENDING" && r.fromUserId === currentUserId);
  const recent = rows.filter((r) => r.status !== "PENDING").slice(0, 8);

  async function accept(id: string, slotId: string) {
    setBusyId(id);
    try {
      await apiFetch(`/meetings/${id}/accept`, withEventHeaders({ method: "POST", body: JSON.stringify({ slotId }) }), token);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Accept failed");
    } finally {
      setBusyId(null);
    }
  }

  async function decline(id: string) {
    setBusyId(id);
    try {
      await apiFetch(`/meetings/${id}/decline`, withEventHeaders({ method: "POST", body: "{}" }), token);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Decline failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="card" style={{ padding: 18, marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>Meeting requests</h3>
      <p className="help-text" style={{ marginTop: 0 }}>
        Propose times from the directory. Accepted meetings land on both personal agendas.
      </p>
      {error ? <p className="help-text" style={{ color: "#b42318" }}>{error}</p> : null}

      {pendingIncoming.length === 0 && pendingOutgoing.length === 0 && recent.length === 0 ? (
        <p className="help-text">No meeting requests yet.</p>
      ) : null}

      {pendingIncoming.length > 0 ? (
        <div style={{ marginBottom: 16 }}>
          <h4 style={{ margin: "0 0 8px" }}>Incoming</h4>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {pendingIncoming.map((m) => (
              <li key={m.id} style={{ borderBottom: "1px solid var(--border)", padding: "10px 0" }}>
                <strong>{m.fromUser.name}</strong>
                {m.message ? <span className="help-text"> — {m.message}</span> : null}
                <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                  {m.slots.map((s) => (
                    <div key={s.id} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <span className="help-text">
                        {new Date(s.startsAt).toLocaleString()} – {new Date(s.endsAt).toLocaleTimeString()}
                      </span>
                      <button
                        type="button"
                        className="button"
                        disabled={busyId === m.id}
                        onClick={() => void accept(m.id, s.id)}
                      >
                        Accept this slot
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busyId === m.id}
                    onClick={() => void decline(m.id)}
                  >
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {pendingOutgoing.length > 0 ? (
        <div style={{ marginBottom: 16 }}>
          <h4 style={{ margin: "0 0 8px" }}>Sent</h4>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {pendingOutgoing.map((m) => (
              <li key={m.id} style={{ borderBottom: "1px solid var(--border)", padding: "10px 0" }}>
                To <strong>{m.toUser.name}</strong>
                <span className="help-text"> · {m.slots.length} proposed slot{m.slots.length === 1 ? "" : "s"}</span>
                <div style={{ marginTop: 6 }}>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busyId === m.id}
                    onClick={() => void decline(m.id)}
                  >
                    Cancel
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {recent.length > 0 ? (
        <div>
          <h4 style={{ margin: "0 0 8px" }}>Recent</h4>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {recent.map((m) => {
              const other = m.fromUserId === currentUserId ? m.toUser : m.fromUser;
              return (
                <li key={m.id} className="help-text" style={{ padding: "6px 0" }}>
                  {other.name} · {m.status.toLowerCase()}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function MeetingRequestModal({
  open,
  toUser,
  token,
  withEventHeaders,
  onClose,
  onSent,
}: {
  open: boolean;
  toUser: { id: string; name: string } | null;
  token: string;
  withEventHeaders: (extra?: RequestInit) => RequestInit;
  onClose: () => void;
  onSent: () => void;
}) {
  const [message, setMessage] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open || !toUser) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!startsAt || !endsAt) {
      setError("Choose a start and end time");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(
        "/meetings",
        withEventHeaders({
          method: "POST",
          body: JSON.stringify({
            toUserId: toUser.id,
            message: message.trim() || undefined,
            slots: [{ startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString() }],
          }),
        }),
        token,
      );
      onSent();
      onClose();
      setMessage("");
      setStartsAt("");
      setEndsAt("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send request");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Request meeting">
      <div className="card" style={{ maxWidth: 420, margin: "10vh auto", padding: 20 }}>
        <h3 style={{ marginTop: 0 }}>Meet with {toUser.name}</h3>
        <form onSubmit={(e) => void submit(e)} style={{ display: "grid", gap: 10 }}>
          <label className="help-text">
            Message (optional)
            <textarea className="input" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
          </label>
          <label className="help-text">
            Proposed start
            <input className="input" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
          </label>
          <label className="help-text">
            Proposed end
            <input className="input" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required />
          </label>
          {error ? <p className="help-text" style={{ color: "#b42318", margin: 0 }}>{error}</p> : null}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="button" disabled={busy}>
              Send request
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
