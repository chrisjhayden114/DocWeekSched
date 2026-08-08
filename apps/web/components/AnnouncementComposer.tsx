import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  announcementAudienceLabel,
  announcementExcerpt,
  type SentAnnouncement,
} from "../lib/announcementDisplay";
import { organizerFetch } from "../lib/organizerApi";
import { ListSkeleton } from "./ListState";
import { Select } from "./Select";

type SessionOpt = { id: string; title: string };
type BudgetInfo = {
  recipientCount: number;
  ceiling: number;
  remaining: number;
  meter: string;
};

type Props = {
  eventId: string;
  sessions: SessionOpt[];
};

/**
 * Organizer announcement composer — segments, preview, emergency, budget meter.
 */
export function AnnouncementComposer({ eventId, sessions }: Props) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<"EVERYONE" | "ROLE" | "SESSION_JOINERS" | "ATTENDANCE_MODE">(
    "EVERYONE",
  );
  const [audienceRole, setAudienceRole] = useState<"ATTENDEE" | "SPEAKER" | "ADMIN">("ATTENDEE");
  const [sessionId, setSessionId] = useState("");
  const [attendanceMode, setAttendanceMode] = useState<"IN_PERSON" | "VIRTUAL" | "ASYNC">("IN_PERSON");
  const [sendEmail, setSendEmail] = useState(false);
  const [isEmergency, setIsEmergency] = useState(false);
  const [emergencyConfirm, setEmergencyConfirm] = useState("");
  const [budget, setBudget] = useState<BudgetInfo | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // E16.3: the record of what was sent. null = load failed (shown explicitly).
  const [sent, setSent] = useState<SentAnnouncement[] | null | undefined>(undefined);

  const refreshSent = useCallback(async () => {
    if (!eventId) return;
    try {
      const list = await organizerFetch<SentAnnouncement[]>("/announcements/", eventId);
      setSent(list);
    } catch {
      setSent(null);
    }
  }, [eventId]);

  useEffect(() => {
    void refreshSent();
  }, [refreshSent]);

  const refreshBudget = useCallback(async () => {
    if (!eventId) return;
    const qs = new URLSearchParams({ audience });
    if (audience === "ROLE") qs.set("audienceRole", audienceRole);
    if (audience === "SESSION_JOINERS" && sessionId) qs.set("sessionId", sessionId);
    if (audience === "ATTENDANCE_MODE") qs.set("attendanceMode", attendanceMode);
    try {
      const info = await organizerFetch<BudgetInfo>(`/announcements/budget?${qs}`, eventId);
      setBudget(info);
    } catch {
      setBudget(null);
    }
  }, [eventId, audience, audienceRole, sessionId, attendanceMode]);

  useEffect(() => {
    void refreshBudget();
  }, [refreshBudget]);

  async function submit(preview: boolean) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await organizerFetch<{
        warning?: string | null;
        recipientCount?: number;
        preview?: boolean;
      }>("/announcements/", eventId, {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          audience,
          audienceRole: audience === "ROLE" ? audienceRole : null,
          sessionId: audience === "SESSION_JOINERS" ? sessionId || null : null,
          attendanceMode: audience === "ATTENDANCE_MODE" ? attendanceMode : null,
          sendEmail: preview ? false : sendEmail,
          isEmergency: preview ? false : isEmergency,
          emergencyConfirm: isEmergency ? emergencyConfirm : undefined,
          preview,
        }),
      });
      if (preview) {
        setMessage("Preview sent to your inbox only.");
      } else {
        setMessage(
          `Sent to ${res.recipientCount ?? "segment"}.${res.warning ? ` Warning: ${res.warning}` : ""}`,
        );
        setTitle("");
        setBody("");
        setEmergencyConfirm("");
        setIsEmergency(false);
      }
      await refreshBudget();
      await refreshSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submit(false);
  }

  return (
    <section style={{ display: "grid", gap: 12, maxWidth: 560 }}>
      <h2 style={{ marginTop: 0 }}>Announcements</h2>
      <p className="help-text">
        Event-wide messages land in the attendee inbox. Important ones may use one push from each attendee&apos;s daily
        budget (except emergency, which bypasses the budget).
      </p>
      {budget ? <p className="help-text">{budget.meter}</p> : null}
      {message ? <p style={{ color: "#0a7a3e" }}>{message}</p> : null}
      {error ? <p style={{ color: "#b42318" }}>{error}</p> : null}

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 10 }}>
        <label>
          Title
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label>
          Body
          <textarea className="input" rows={5} value={body} onChange={(e) => setBody(e.target.value)} required />
        </label>
        <label>
          Audience
          <Select
            value={audience}
            onChange={(v) => setAudience(v as typeof audience)}
            options={[
              { value: "EVERYONE", label: "Everyone" },
              { value: "ROLE", label: "By role" },
              { value: "SESSION_JOINERS", label: "Session joiners" },
              { value: "ATTENDANCE_MODE", label: "Attendance mode" },
            ]}
          />
        </label>
        {audience === "ROLE" ? (
          <label>
            Role
            <Select
              value={audienceRole}
              onChange={(v) => setAudienceRole(v as typeof audienceRole)}
              options={[
                { value: "ATTENDEE", label: "Attendees" },
                { value: "SPEAKER", label: "Speakers" },
                { value: "ADMIN", label: "Admins" },
              ]}
            />
          </label>
        ) : null}
        {audience === "SESSION_JOINERS" ? (
          <label>
            Session
            <Select
              value={sessionId}
              onChange={setSessionId}
              required
              placeholder="Select session"
              options={sessions.map((s) => ({ value: s.id, label: s.title }))}
            />
          </label>
        ) : null}
        {audience === "ATTENDANCE_MODE" ? (
          <label>
            Mode
            <Select
              value={attendanceMode}
              onChange={(v) => setAttendanceMode(v as typeof attendanceMode)}
              options={[
                { value: "IN_PERSON", label: "In person" },
                { value: "VIRTUAL", label: "Virtual" },
                { value: "ASYNC", label: "Async" },
              ]}
            />
          </label>
        ) : null}

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
          Also email (rate-limited)
        </label>

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={isEmergency}
            onChange={(e) => setIsEmergency(e.target.checked)}
          />
          Emergency broadcast (bypasses budget & quiet hours)
        </label>
        {isEmergency ? (
          <label>
            Type EMERGENCY to confirm
            <input
              className="input"
              value={emergencyConfirm}
              onChange={(e) => setEmergencyConfirm(e.target.value)}
              placeholder="EMERGENCY"
              required
            />
          </label>
        ) : null}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="button secondary" disabled={busy} onClick={() => void submit(true)}>
            Preview to me
          </button>
          <button type="submit" className="button" disabled={busy}>
            {isEmergency ? "Send emergency" : "Send announcement"}
          </button>
        </div>
      </form>

      {/* E16.3: the record of what was sent — audience, time, sender. */}
      <section style={{ marginTop: 12 }} aria-label="Sent announcements">
        <h3 style={{ margin: "0 0 4px" }}>Sent announcements</h3>
        {sent === undefined ? <ListSkeleton rows={2} /> : null}
        {sent === null ? (
          <p className="help-text" style={{ color: "var(--danger)" }}>
            Couldn’t load past announcements — reload the page to retry.
          </p>
        ) : null}
        {sent && sent.length === 0 ? (
          <p className="help-text" style={{ margin: 0 }}>
            Nothing sent yet. Announcements you send appear here with their audience and time.
          </p>
        ) : null}
        {sent && sent.length > 0 ? (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {sent.map((a) => (
              <li
                key={a.id}
                style={{
                  border: "1px solid var(--gray-200)",
                  borderRadius: "var(--radius-sm)",
                  padding: "8px 12px",
                }}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                  <strong style={{ font: "var(--text-label)", color: "var(--gray-900)" }}>{a.title}</strong>
                  {a.isPreview ? <span className="chip">Preview — only you</span> : null}
                  {a.isEmergency ? (
                    <span className="chip" style={{ color: "var(--danger)" }}>
                      Emergency
                    </span>
                  ) : null}
                  {a.sendEmail ? <span className="chip">Email</span> : null}
                </div>
                {a.body ? (
                  <p style={{ margin: "2px 0 0", font: "var(--text-body)" }}>{announcementExcerpt(a.body)}</p>
                ) : null}
                <p className="text-meta" style={{ margin: "4px 0 0" }}>
                  To {announcementAudienceLabel(a)} · {new Date(a.publishedAt || a.createdAt).toLocaleString()}
                  {a.createdBy?.name ? <> · by {a.createdBy.name}</> : null}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </section>
  );
}
