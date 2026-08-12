import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

type TranscriptLine = {
  senderId: string | null;
  senderName: string;
  body: string;
  createdAt: string;
};

type ReportRow = {
  id: string;
  reason: string;
  details: string | null;
  status: "OPEN" | "REVIEWED" | "DISMISSED";
  createdAt: string;
  reporter: { id: string; name: string; email: string };
  reportedUser: { id: string; name: string; email: string };
  conversationId?: string | null;
  transcriptSnapshot?: TranscriptLine[] | null;
  reportedUserSuspended?: boolean;
};

export function ModerationReportsPanel({
  token,
  withEventHeaders,
}: {
  token: string;
  withEventHeaders: (extra?: RequestInit) => RequestInit;
}) {
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transcriptOpenId, setTranscriptOpenId] = useState<string | null>(null);
  const [confirmSuspendId, setConfirmSuspendId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await apiFetch<ReportRow[]>("/moderation/reports", withEventHeaders(), token);
      setRows(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load reports");
    }
  }, [token, withEventHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  async function resolve(id: string, status: "REVIEWED" | "DISMISSED") {
    setBusyId(id);
    try {
      await apiFetch(
        `/moderation/reports/${id}/resolve`,
        withEventHeaders({ method: "POST", body: JSON.stringify({ status }) }),
        token,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resolve failed");
    } finally {
      setBusyId(null);
    }
  }

  async function setSuspended(row: ReportRow, suspended: boolean) {
    setBusyId(row.id);
    try {
      await apiFetch(
        "/moderation/suspend-messaging",
        withEventHeaders({
          method: "POST",
          body: JSON.stringify({ userId: row.reportedUser.id, suspended }),
        }),
        token,
      );
      setConfirmSuspendId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update messaging");
    } finally {
      setBusyId(null);
    }
  }

  const open = rows.filter((r) => r.status === "OPEN");
  const closed = rows.filter((r) => r.status !== "OPEN").slice(0, 20);

  return (
    <div className="card" style={{ padding: 18 }}>
      <h3 style={{ marginTop: 0 }}>Moderation</h3>
      <p className="help-text" style={{ marginTop: 0 }}>
        Attendee reports from the directory and Messages. Review, dismiss, or suspend messaging —
        nothing is auto-actioned.
      </p>
      {error ? <p className="help-text" style={{ color: "#b42318" }}>{error}</p> : null}

      {open.length === 0 ? <p className="help-text">No open reports.</p> : null}
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {open.map((r) => {
          const snapshot = Array.isArray(r.transcriptSnapshot) ? r.transcriptSnapshot : null;
          const transcriptOpen = transcriptOpenId === r.id;
          const confirmingSuspend = confirmSuspendId === r.id;
          const suspended = !!r.reportedUserSuspended;
          return (
            <li key={r.id} style={{ borderBottom: "1px solid var(--border)", padding: "12px 0" }}>
              <div>
                <strong>{r.reportedUser.name}</strong>
                <span className="help-text"> reported by {r.reporter.name}</span>
              </div>
              <div style={{ marginTop: 4 }}>{r.reason}</div>
              {r.details ? <p className="help-text" style={{ margin: "4px 0 0" }}>{r.details}</p> : null}
              {snapshot ? (
                <div style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setTranscriptOpenId(transcriptOpen ? null : r.id)}
                  >
                    {transcriptOpen ? "Hide conversation" : "View conversation"}
                  </button>
                  {transcriptOpen ? (
                    <div
                      style={{
                        marginTop: 8,
                        padding: 10,
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                      }}
                    >
                      <p className="help-text" style={{ margin: "0 0 8px" }}>
                        Snapshot taken when the report was filed.
                      </p>
                      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                        {snapshot.map((line, i) => (
                          <li
                            key={`${line.createdAt}-${i}`}
                            style={{
                              padding: "6px 0",
                              borderTop: i === 0 ? undefined : "1px solid var(--border)",
                            }}
                          >
                            <div className="help-text">
                              {line.senderName} · {new Date(line.createdAt).toLocaleString()}
                            </div>
                            <div>{line.body}</div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button
                  type="button"
                  className="button"
                  disabled={busyId === r.id}
                  onClick={() => void resolve(r.id, "REVIEWED")}
                >
                  Mark reviewed
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busyId === r.id}
                  onClick={() => void resolve(r.id, "DISMISSED")}
                >
                  Dismiss
                </button>
                {confirmingSuspend ? (
                  <>
                    <span className="help-text">
                      {suspended
                        ? `Allow messaging for ${r.reportedUser.name} again?`
                        : `Suspend messaging for ${r.reportedUser.name}?`}
                    </span>
                    <button
                      type="button"
                      className="button"
                      disabled={busyId === r.id}
                      onClick={() => void setSuspended(r, !suspended)}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busyId === r.id}
                      onClick={() => setConfirmSuspendId(null)}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busyId === r.id}
                    onClick={() => setConfirmSuspendId(r.id)}
                  >
                    {suspended ? "Unsuspend messaging" : "Suspend messaging"}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {closed.length > 0 ? (
        <div style={{ marginTop: 16 }}>
          <h4 style={{ margin: "0 0 8px" }}>Resolved</h4>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {closed.map((r) => (
              <li key={r.id} className="help-text" style={{ padding: "4px 0" }}>
                {r.reportedUser.name} · {r.status.toLowerCase()} · {r.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
