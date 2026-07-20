import { FormEvent, useCallback, useEffect, useState } from "react";
import { organizerFetch } from "../lib/organizerApi";

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
          <select
            className="input"
            value={audience}
            onChange={(e) => setAudience(e.target.value as typeof audience)}
          >
            <option value="EVERYONE">Everyone</option>
            <option value="ROLE">By role</option>
            <option value="SESSION_JOINERS">Session joiners</option>
            <option value="ATTENDANCE_MODE">Attendance mode</option>
          </select>
        </label>
        {audience === "ROLE" ? (
          <label>
            Role
            <select
              className="input"
              value={audienceRole}
              onChange={(e) => setAudienceRole(e.target.value as typeof audienceRole)}
            >
              <option value="ATTENDEE">Attendees</option>
              <option value="SPEAKER">Speakers</option>
              <option value="ADMIN">Admins</option>
            </select>
          </label>
        ) : null}
        {audience === "SESSION_JOINERS" ? (
          <label>
            Session
            <select className="input" value={sessionId} onChange={(e) => setSessionId(e.target.value)} required>
              <option value="">Select session</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {audience === "ATTENDANCE_MODE" ? (
          <label>
            Mode
            <select
              className="input"
              value={attendanceMode}
              onChange={(e) => setAttendanceMode(e.target.value as typeof attendanceMode)}
            >
              <option value="IN_PERSON">In person</option>
              <option value="VIRTUAL">Virtual</option>
              <option value="ASYNC">Async</option>
            </select>
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
    </section>
  );
}
