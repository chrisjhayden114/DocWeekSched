import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

type ReportRow = {
  id: string;
  reason: string;
  details: string | null;
  status: "OPEN" | "REVIEWED" | "DISMISSED";
  createdAt: string;
  reporter: { id: string; name: string; email: string };
  reportedUser: { id: string; name: string; email: string };
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

  const open = rows.filter((r) => r.status === "OPEN");
  const closed = rows.filter((r) => r.status !== "OPEN").slice(0, 20);

  return (
    <div className="card" style={{ padding: 18 }}>
      <h3 style={{ marginTop: 0 }}>Moderation</h3>
      <p className="help-text" style={{ marginTop: 0 }}>
        Attendee reports from the directory. Review or dismiss — nothing is auto-actioned.
      </p>
      {error ? <p className="help-text" style={{ color: "#b42318" }}>{error}</p> : null}

      {open.length === 0 ? <p className="help-text">No open reports.</p> : null}
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {open.map((r) => (
          <li key={r.id} style={{ borderBottom: "1px solid var(--border)", padding: "12px 0" }}>
            <div>
              <strong>{r.reportedUser.name}</strong>
              <span className="help-text"> reported by {r.reporter.name}</span>
            </div>
            <div style={{ marginTop: 4 }}>{r.reason}</div>
            {r.details ? <p className="help-text" style={{ margin: "4px 0 0" }}>{r.details}</p> : null}
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
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
            </div>
          </li>
        ))}
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
