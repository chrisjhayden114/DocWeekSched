import type { PresenterRosterSession } from "@event-app/shared";
import { formatEventTimeRange } from "../lib/dateFormat";
import {
  PRESENTER_PORTAL_SESSIONS_TITLE,
  PRESENTER_ROSTER_EMPTY,
  SESSION_PAGE_PRESENTER_ROSTER_TITLE,
  hasPresenterRosterNames,
  presenterRosterHiddenLine,
  presenterRosterJoinedLine,
  presenterRosterWaitlistLine,
} from "../lib/presenterRoster";

function RosterCounts({ session }: { session: PresenterRosterSession }) {
  const waitlist = presenterRosterWaitlistLine(session.waitlistCount);
  if (session.joinedCount === 0 && session.waitlistCount === 0) {
    return <p className="help-text" style={{ margin: 0 }}>{PRESENTER_ROSTER_EMPTY}</p>;
  }
  return (
    <p className="text-meta" style={{ margin: 0 }}>
      {presenterRosterJoinedLine(session)}
      {waitlist ? ` ${waitlist}` : ""}
    </p>
  );
}

function RosterNames({ session }: { session: PresenterRosterSession }) {
  if (!hasPresenterRosterNames(session)) return null;
  const hidden = presenterRosterHiddenLine(session.hiddenCount ?? 0);
  if (session.attendees.length === 0 && !hidden) return null;

  return (
    <details style={{ margin: 0 }}>
      <summary className="text-meta" style={{ cursor: "pointer" }}>
        {session.attendees.length === 1 ? "1 name" : `${session.attendees.length} names`}
      </summary>
      {session.attendees.length > 0 ? (
        <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
          {session.attendees.map((person) => (
            <li key={`${person.displayName}-${person.affiliation ?? ""}`}>
              {person.displayName}
              {person.affiliation ? (
                <span className="text-meta"> · {person.affiliation}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {hidden ? (
        <p className="help-text" style={{ margin: "8px 0 0" }}>
          {hidden}
        </p>
      ) : null}
    </details>
  );
}

export function PresenterRosterSessionRow({
  session,
  timezone,
  showTitle = true,
}: {
  session: PresenterRosterSession;
  timezone: string;
  showTitle?: boolean;
}) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {showTitle ? <strong>{session.title}</strong> : null}
      <p className="text-meta" style={{ margin: 0 }}>
        {formatEventTimeRange(session.startsAt, session.endsAt, timezone)}
        {session.roomName ? ` · ${session.roomName}` : ""}
      </p>
      <RosterCounts session={session} />
      <RosterNames session={session} />
    </div>
  );
}

export function PresenterPortalSessionsCard({
  sessions,
  timezone,
}: {
  sessions: PresenterRosterSession[];
  timezone: string;
}) {
  if (sessions.length === 0) return null;
  return (
    <section className="card" style={{ padding: 16, display: "grid", gap: 16 }}>
      <h2 className="text-h3" style={{ margin: 0 }}>
        {PRESENTER_PORTAL_SESSIONS_TITLE}
      </h2>
      {sessions.map((session) => (
        <PresenterRosterSessionRow key={session.id} session={session} timezone={timezone} />
      ))}
    </section>
  );
}

export function SessionPresenterRosterPanel({
  session,
  timezone,
}: {
  session: PresenterRosterSession;
  timezone: string;
}) {
  return (
    <section style={{ display: "grid", gap: 8, margin: "0 0 12px" }}>
      <h2 className="text-h3" style={{ margin: 0 }}>
        {SESSION_PAGE_PRESENTER_ROSTER_TITLE}
      </h2>
      <PresenterRosterSessionRow session={session} timezone={timezone} showTitle={false} />
    </section>
  );
}
