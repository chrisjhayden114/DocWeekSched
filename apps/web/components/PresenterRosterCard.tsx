import { sessionFormatLabel, type PresenterRosterSession } from "@event-app/shared";
import { useEffect, useState } from "react";
import { CardAvatar } from "./SessionCardBits";
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
import { browserTimezone } from "../lib/timezones";

/** Under 480px the roster grid is a single column. */
function rosterIsOneColumn(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(max-width: 479px)").matches;
}

function useOneColumnRoster(): boolean {
  const [oneColumn, setOneColumn] = useState(rosterIsOneColumn);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 479px)");
    const apply = () => setOneColumn(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return oneColumn;
}

function sessionTimeLine(startsAt: string, endsAt: string, eventZone: string): string {
  const eventTime = formatEventTimeRange(startsAt, endsAt, eventZone);
  const localZone = browserTimezone();
  if (!localZone || localZone === eventZone) return eventTime;
  const localTime = formatEventTimeRange(startsAt, endsAt, localZone);
  if (!localTime) return eventTime;
  return `${eventTime} (${localTime})`;
}

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
  const oneColumn = useOneColumnRoster();
  if (!hasPresenterRosterNames(session)) return null;
  const hidden = presenterRosterHiddenLine(session.hiddenCount ?? 0);
  if (session.attendees.length === 0 && !hidden) return null;

  return (
    <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
      {session.attendees.length > 0 ? (
        <ul
          className="presenter-roster-grid"
          style={{
            display: "grid",
            gridTemplateColumns: oneColumn ? "1fr" : "repeat(auto-fill, minmax(160px, 1fr))",
            gap: 8,
            margin: 0,
            padding: 0,
            listStyle: "none",
            minWidth: 0,
          }}
        >
          {session.attendees.map((person, index) => (
            <li
              key={`${person.displayName}-${person.affiliation ?? ""}-${index}`}
              className="card"
              style={{
                margin: 0,
                padding: 12,
                minWidth: 0,
                display: "flex",
                gap: 8,
                alignItems: "center",
              }}
            >
              <CardAvatar
                person={{ name: person.displayName, photoUrl: person.photoUrl ?? null }}
              />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", overflowWrap: "anywhere" }}>{person.displayName}</span>
                {person.title ? (
                  <span className="text-meta" style={{ display: "block", overflowWrap: "anywhere" }}>
                    {person.title}
                  </span>
                ) : null}
                {person.affiliation ? (
                  <span className="text-meta" style={{ display: "block", overflowWrap: "anywhere" }}>
                    {person.affiliation}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {hidden ? (
        <p className="help-text" style={{ margin: 0 }}>
          {hidden}
        </p>
      ) : null}
    </div>
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

function PresenterHomeSession({
  session,
  timezone,
  eventSlug,
}: {
  session: PresenterRosterSession;
  timezone: string;
  eventSlug?: string;
}) {
  const formatLabel = sessionFormatLabel(session.format);
  const zoom = session.zoomLink?.trim() || "";
  const papers = session.items ?? [];
  return (
    <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
      <strong style={{ overflowWrap: "anywhere" }}>{session.title}</strong>
      <p className="text-meta" style={{ margin: 0, overflowWrap: "anywhere" }}>
        {sessionTimeLine(session.startsAt, session.endsAt, timezone)}
      </p>
      {session.roomName ? (
        <p className="text-meta" style={{ margin: 0, overflowWrap: "anywhere" }}>
          {session.roomName}
        </p>
      ) : null}
      {session.trackName ? (
        <p className="session-peek-track-row" style={{ margin: 0 }}>
          <span
            className="session-peek-track"
            style={session.trackColor ? { ["--track-color" as string]: session.trackColor } : undefined}
          >
            <span className="session-peek-track-dot" aria-hidden />
            {session.trackName}
          </span>
        </p>
      ) : null}
      {formatLabel ? <span className="schedule-option-chip">{formatLabel}</span> : null}
      {session.description ? (
        <p style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{session.description}</p>
      ) : null}
      {papers.length > 0 ? (
        <ul className="session-peek-papers">
          {papers.map((paper, index) => (
            <li key={`${paper.title}-${index}`} className="session-peek-paper">
              <span className="session-peek-paper-title">{paper.title}</span>
              {paper.abstract ? (
                <p className="help-text" style={{ margin: "4px 0 0", overflowWrap: "anywhere" }}>
                  {paper.abstract}
                </p>
              ) : null}
              {paper.authors.length > 0 ? (
                <span className="session-peek-paper-authors">
                  {paper.authors.map((author, authorIndex) => (
                    <span key={`${author.name}-${authorIndex}`}>
                      {authorIndex > 0 ? ", " : ""}
                      {author.isPresenter ? <strong>{author.name}</strong> : author.name}
                    </span>
                  ))}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <RosterCounts session={session} />
      <RosterNames session={session} />
      {eventSlug ? (
        <p className="text-meta" style={{ margin: 0, display: "flex", flexWrap: "wrap", gap: 12 }}>
          <a href={`/e/${encodeURIComponent(eventSlug)}?session=${encodeURIComponent(session.id)}`}>
            Open in the conference schedule
          </a>
          <a href={`/e/${encodeURIComponent(eventSlug)}`}>Full program</a>
        </p>
      ) : null}
      {zoom ? (
        <a
          className="button"
          href={zoom}
          target="_blank"
          rel="noreferrer"
          style={{ justifySelf: "start", minHeight: 44, maxWidth: "100%" }}
        >
          Join online
        </a>
      ) : null}
    </div>
  );
}

export function PresenterPortalSessionsCard({
  sessions,
  timezone,
  eventSlug,
}: {
  sessions: PresenterRosterSession[];
  timezone: string;
  eventSlug?: string;
}) {
  if (sessions.length === 0) return null;
  return (
    <section className="card" style={{ padding: 16, display: "grid", gap: 16, minWidth: 0 }}>
      <h2 className="text-h3" style={{ margin: 0 }}>
        {PRESENTER_PORTAL_SESSIONS_TITLE}
      </h2>
      {sessions.map((session) => (
        <PresenterHomeSession key={session.id} session={session} timezone={timezone} eventSlug={eventSlug} />
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
