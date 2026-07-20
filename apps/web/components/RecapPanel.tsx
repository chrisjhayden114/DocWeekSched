import { useCallback, useEffect, useState } from "react";
import { organizerFetch } from "../lib/organizerApi";

type RecapSection = {
  id: string;
  kind: string;
  status: string;
  title: string;
  bodyMarkdown: string;
  aiGenerated: boolean;
  sponsorId?: string | null;
};

type RecapEmail = {
  id: string;
  kind: string;
  status: string;
  subject: string;
  body: string;
  sentAt: string | null;
  aiGenerated: boolean;
};

type RecapWorkspace = {
  eventId: string;
  endDate: string;
  canGenerate: boolean;
  aiGeneratedLabel: boolean;
  recap: {
    id: string;
    status: string;
    generatedAt: string | null;
    regeneratedAt: string | null;
    sections: RecapSection[];
    emails: RecapEmail[];
    fixNextYear: unknown;
  } | null;
};

export function RecapPanel({ eventId }: { eventId: string }) {
  const [data, setData] = useState<RecapWorkspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await organizerFetch<RecapWorkspace>("/ai/recap", eventId);
      setData(res);
      const first = res.recap?.sections?.[0];
      if (first) {
        setSelectedSection(first.id);
        setEditBody(first.bodyMarkdown);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load recap");
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      await organizerFetch("/ai/recap/generate", eventId, {
        method: "POST",
        body: JSON.stringify({ sync: true }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generate failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveSection() {
    if (!selectedSection) return;
    setBusy(true);
    setError(null);
    try {
      await organizerFetch(`/ai/recap/sections/${selectedSection}`, eventId, {
        method: "PATCH",
        body: JSON.stringify({ bodyMarkdown: editBody }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function sendEmail(emailId: string) {
    setBusy(true);
    setError(null);
    try {
      await organizerFetch(`/ai/recap/emails/${emailId}/send`, eventId, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) {
    return <p className="help-text" style={{ color: "#b42318" }}>{error}</p>;
  }
  if (!data) return <p className="help-text">Loading recap…</p>;

  const sections = data.recap?.sections ?? [];
  const emails = data.recap?.emails ?? [];

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, flex: 1 }}>Post-event recap</h2>
        {data.recap?.status ? (
          <span className="help-text">Status: {data.recap.status}</span>
        ) : null}
        <button
          type="button"
          className="button"
          disabled={busy || !data.canGenerate}
          onClick={() => void generate()}
          title={data.canGenerate ? undefined : "Available after the event end date"}
        >
          {data.recap ? "Regenerate" : "Generate event recap"}
        </button>
        {data.recap ? (
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => {
              void (async () => {
                try {
                  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
                  const res = await fetch(`${API_URL}/ai/recap/export.csv`, {
                    credentials: "include",
                    headers: { "x-event-id": eventId },
                  });
                  if (!res.ok) throw new Error("Export failed");
                  const csv = await res.text();
                  const blob = new Blob([csv], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `recap-${eventId}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Export failed");
                }
              })();
            }}
          >
            Export CSV
          </button>
        ) : null}
      </div>

      <p className="help-text">
        Numbers come from verified SQL metrics (placeholder substitution only). Drafts are labeled AI-generated.
        Emails send only when you click Send — never on generate. Certificates use the existing batch-issue path
        without auto-emailing attendees.
      </p>

      {!data.canGenerate ? (
        <p className="help-text">Generate unlocks after {new Date(data.endDate).toLocaleString()}.</p>
      ) : null}

      {error ? <p style={{ color: "#b42318" }}>{error}</p> : null}

      {sections.length > 0 ? (
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "200px 1fr" }}>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {sections.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={selectedSection === s.id ? "button" : "button secondary"}
                  style={{ width: "100%", marginBottom: 6, textAlign: "left" }}
                  onClick={() => {
                    setSelectedSection(s.id);
                    setEditBody(s.bodyMarkdown);
                  }}
                >
                  {s.kind.replace(/_/g, " ")}
                  {s.aiGenerated ? " · AI" : ""}
                </button>
              </li>
            ))}
          </ul>
          <div>
            <textarea
              className="input"
              rows={18}
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: 13 }}
            />
            <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
              <button type="button" className="button" disabled={busy} onClick={() => void saveSection()}>
                Save draft
              </button>
            </div>
          </div>
        </div>
      ) : (
        <p className="help-text">No recap workspace yet — generate after the event ends.</p>
      )}

      {emails.length > 0 ? (
        <div>
          <h3>Email drafts</h3>
          <ul style={{ display: "grid", gap: 12, padding: 0, listStyle: "none" }}>
            {emails.map((e) => (
              <li key={e.id} style={{ borderTop: "1px solid #e5e5e5", paddingTop: 12 }}>
                <strong>{e.kind.replace(/_/g, " ")}</strong>
                {e.aiGenerated ? <span className="help-text"> · AI-generated</span> : null}
                <div className="help-text">{e.status}{e.sentAt ? ` · sent ${new Date(e.sentAt).toLocaleString()}` : ""}</div>
                <div style={{ fontWeight: 600, marginTop: 4 }}>{e.subject}</div>
                <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, margin: "8px 0" }}>{e.body}</pre>
                {e.status === "DRAFT" ? (
                  <button type="button" className="button" disabled={busy} onClick={() => void sendEmail(e.id)}>
                    Send via announcements
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
