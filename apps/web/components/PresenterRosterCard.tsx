import {
  PRESENTER_NOTE_MAX_CHARS,
  sessionFormatLabel,
  type PresenterRelatedSession,
  type PresenterRosterAttendee,
  type PresenterRosterNote,
  type PresenterRosterSession,
} from "@event-app/shared";
import { useState } from "react";
import { RelatedSessionCard } from "./RelatedSessionCard";
import { CardAvatar } from "./SessionCardBits";
import { AutoGrowTextarea } from "./kit";
import { HoverInfo } from "./kit/HoverInfo";
import { formatEventDateTime, formatEventTimeRange } from "../lib/dateFormat";
import { API_URL } from "../lib/api";
import {
  PRESENTER_NOTE_COMPOSER_LABEL,
  PRESENTER_NOTE_HELP,
  PRESENTER_NOTE_SEND,
  PRESENTER_NOTES_HEADING,
  PRESENTER_NOTES_TO_ATTENDEES,
  PRESENTER_PORTAL_SESSIONS_TITLE,
  PRESENTER_ROSTER_EMPTY,
  PRESENTER_ROSTER_PAGE_SIZE,
  PRESENTER_ROSTER_SEARCH_PLACEHOLDER,
  PRESENTER_ROSTER_SHOW_MORE,
  PRESENTER_ROSTER_SORT_AFFILIATION,
  PRESENTER_ROSTER_TRUNCATED,
  SESSION_PAGE_PRESENTER_ROSTER_TITLE,
  SESSIONS_LIKE_YOURS,
  hasPresenterRosterNames,
  presenterNoteCountLabel,
  presenterRosterHeadline,
  presenterRosterMatchesQuery,
  presenterRosterNamesShownLine,
  sortPresenterRosterAttendees,
} from "../lib/presenterRoster";
import { browserTimezone } from "../lib/timezones";

function sessionTimeLine(startsAt: string, endsAt: string, eventZone: string): string {
  const eventTime = formatEventTimeRange(startsAt, endsAt, eventZone);
  const localZone = browserTimezone();
  if (!localZone || localZone === eventZone) return eventTime;
  const localTime = formatEventTimeRange(startsAt, endsAt, localZone);
  if (!localTime) return eventTime;
  return `${eventTime} (${localTime})`;
}

function formatChipLabel(session: PresenterRosterSession): string | null {
  const label = sessionFormatLabel(session.format);
  if (!label) return null;
  const track = session.trackName?.trim() ?? "";
  if (track && label.toLowerCase() === track.toLowerCase()) return null;
  return label;
}

function rosterMeta(person: PresenterRosterAttendee): string | null {
  const parts = [person.title, person.affiliation].filter((part): part is string => Boolean(part && part.trim()));
  return parts.length > 0 ? parts.join(" · ") : null;
}

function popoverBody(person: PresenterRosterAttendee): string {
  const meta = rosterMeta(person);
  const bio = person.bio?.trim() ?? "";
  return [meta, bio].filter(Boolean).join("\n\n");
}

function RosterHeadline({ session }: { session: PresenterRosterSession }) {
  return (
    <p className="text-meta" style={{ margin: 0 }}>
      {presenterRosterHeadline(session)}
    </p>
  );
}

function RosterPersonCard({ person }: { person: PresenterRosterAttendee }) {
  const meta = rosterMeta(person);
  return (
    <HoverInfo
      trigger="label"
      title={person.displayName}
      body={popoverBody(person)}
      imageSrc={person.photoUrl}
    >
      <span className="card presenter-roster-person">
        <CardAvatar
          className="presenter-roster-avatar"
          person={{ name: person.displayName, photoUrl: person.photoUrl ?? null }}
        />
        <span style={{ minWidth: 0 }}>
          <span className="presenter-roster-name">{person.displayName}</span>
          {meta ? <span className="text-meta presenter-roster-meta">{meta}</span> : null}
        </span>
      </span>
    </HoverInfo>
  );
}

function RosterNames({ session }: { session: PresenterRosterSession }) {
  const [query, setQuery] = useState("");
  const [byAffiliation, setByAffiliation] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PRESENTER_ROSTER_PAGE_SIZE);
  if (!hasPresenterRosterNames(session)) return null;

  const filtered = session.attendees.filter((person) => presenterRosterMatchesQuery(person, query));
  const ordered = sortPresenterRosterAttendees(filtered, byAffiliation ? "affiliation" : "name");
  const page = ordered.slice(0, visibleCount);
  const groups: Array<{ affiliation: string; people: PresenterRosterAttendee[] }> = [];
  if (byAffiliation) {
    for (const person of page) {
      const affiliation = person.affiliation?.trim() ?? "";
      const last = groups[groups.length - 1];
      if (last && last.affiliation === affiliation) last.people.push(person);
      else groups.push({ affiliation, people: [person] });
    }
  } else {
    groups.push({ affiliation: "", people: page });
  }

  return (
    <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
      <p className="text-meta" style={{ margin: 0 }}>
        {presenterRosterNamesShownLine(session.attendees.length, session.hiddenCount ?? 0)}
      </p>
      {session.truncated ? (
        <p className="help-text" style={{ margin: 0 }}>
          {PRESENTER_ROSTER_TRUNCATED}
        </p>
      ) : null}
      <input
        type="search"
        className="input"
        value={query}
        placeholder={PRESENTER_ROSTER_SEARCH_PLACEHOLDER}
        aria-label={PRESENTER_ROSTER_SEARCH_PLACEHOLDER}
        onChange={(event) => {
          setQuery(event.target.value);
          setVisibleCount(PRESENTER_ROSTER_PAGE_SIZE);
        }}
      />
      <button
        type="button"
        className="button secondary"
        aria-pressed={byAffiliation}
        style={{ justifySelf: "start" }}
        onClick={() => setByAffiliation((on) => !on)}
      >
        {PRESENTER_ROSTER_SORT_AFFILIATION}
      </button>
      {groups.map((group) => (
        <div key={group.affiliation || "none"} style={{ display: "grid", gap: 8, minWidth: 0 }}>
          {byAffiliation && group.affiliation ? (
            <p className="text-meta presenter-roster-group" style={{ margin: 0 }}>
              {group.affiliation}
            </p>
          ) : null}
          {group.people.length > 0 ? (
            <ul className="presenter-roster-grid">
              {group.people.map((person, index) => (
                <li key={`${person.displayName}-${person.affiliation ?? ""}-${index}`}>
                  <RosterPersonCard person={person} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
      {ordered.length > visibleCount ? (
        <button
          type="button"
          className="button secondary"
          style={{ justifySelf: "start" }}
          onClick={() => setVisibleCount((count) => count + PRESENTER_ROSTER_PAGE_SIZE)}
        >
          {PRESENTER_ROSTER_SHOW_MORE}
        </button>
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
      <RosterHeadline session={session} />
      <RosterNames session={session} />
    </div>
  );
}

function PresenterNoteList({ notes }: { notes: PresenterRosterNote[] }) {
  if (notes.length === 0) return null;
  const ordered = [...notes].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
      {ordered.map((note) => (
        <li key={note.id} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {note.body}
        </li>
      ))}
    </ul>
  );
}

function PortalNoteList({ notes, timezone }: { notes: PresenterRosterNote[]; timezone: string }) {
  if (notes.length === 0) return null;
  const ordered = [...notes].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
      {ordered.map((note) => (
        <li key={note.id}>
          <p style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{note.body}</p>
          <p className="text-meta" style={{ margin: 0 }}>
            {formatEventDateTime(note.createdAt, timezone)}
          </p>
        </li>
      ))}
    </ul>
  );
}

function PresenterNoteComposer({
  session,
  token,
  enabled,
  timezone,
}: {
  session: PresenterRosterSession;
  token: string;
  enabled: boolean;
  timezone: string;
}) {
  const [draft, setDraft] = useState("");
  const [notes, setNotes] = useState<PresenterRosterNote[]>(session.notes ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const trimmed = draft.trim();

  async function send() {
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_URL}/portal/${encodeURIComponent(token)}/sessions/${encodeURIComponent(session.id)}/note`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: trimmed }),
        },
      );
      let json: { error?: string; id?: string; body?: string; createdAt?: string } = {};
      try {
        json = (await res.json()) as typeof json;
      } catch {
        throw new Error(
          res.ok
            ? "The server returned a note the page could not read. Refresh before sending again."
            : "Could not send the note.",
        );
      }
      if (!res.ok) {
        throw new Error(typeof json.error === "string" ? json.error : "Could not send the note.");
      }
      if (!json.id || typeof json.body !== "string" || !json.createdAt) {
        throw new Error("The server did not return the note. Refresh before sending again.");
      }
      setNotes((prev) => [{ id: json.id!, body: json.body!, createdAt: json.createdAt! }, ...prev]);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the note.");
    } finally {
      setBusy(false);
    }
  }

  if (!enabled && notes.length === 0) return null;

  return (
    <section className="presenter-notes" style={{ display: "grid", gap: 8, minWidth: 0 }}>
      <h4 className="text-h3" style={{ margin: 0 }}>
        {PRESENTER_NOTES_TO_ATTENDEES}
      </h4>
      <PortalNoteList notes={notes} timezone={timezone} />
      {enabled ? (
        <>
          <label style={{ display: "grid", gap: 6 }}>
            <span>{PRESENTER_NOTE_COMPOSER_LABEL}</span>
            <AutoGrowTextarea
              value={draft}
              maxLength={PRESENTER_NOTE_MAX_CHARS}
              onChange={(event) => setDraft(event.target.value)}
              aria-label={PRESENTER_NOTE_COMPOSER_LABEL}
            />
          </label>
          <p className="text-meta" style={{ margin: 0 }}>
            {presenterNoteCountLabel(draft.length)}
          </p>
          <p className="help-text" style={{ margin: 0 }}>
            {PRESENTER_NOTE_HELP}
          </p>
          {error ? (
            <p role="alert" style={{ color: "var(--danger)", margin: 0 }}>
              {error}
            </p>
          ) : null}
          <button
            type="button"
            className="button"
            style={{ justifySelf: "start", minHeight: 44 }}
            disabled={busy || trimmed.length === 0}
            onClick={() => void send()}
          >
            {PRESENTER_NOTE_SEND}
          </button>
        </>
      ) : null}
    </section>
  );
}

export function PresenterSessionNotes({ notes }: { notes: PresenterRosterNote[] }) {
  if (notes.length === 0) return null;
  return (
    <section style={{ display: "grid", gap: 8, margin: "0 0 12px" }}>
      <h2 className="text-h3" style={{ margin: 0 }}>
        {PRESENTER_NOTES_HEADING}
      </h2>
      <PresenterNoteList notes={notes} />
    </section>
  );
}

function RelatedSessionsList({
  related,
  eventSlug,
  timezone,
}: {
  related: PresenterRelatedSession[] | undefined;
  eventSlug?: string;
  timezone: string;
}) {
  if (!eventSlug || !related || related.length === 0) return null;
  return (
    <section className="presenter-related">
      <h4 className="text-h3" style={{ margin: 0 }}>
        {SESSIONS_LIKE_YOURS}
      </h4>
      <ul className="presenter-related-grid">
        {related.map((item) => (
          <li key={item.id}>
            <RelatedSessionCard session={item} eventSlug={eventSlug} timezone={timezone} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function sessionsByStart(sessions: PresenterRosterSession[]): PresenterRosterSession[] {
  return [...sessions].sort((a, b) => {
    if (a.startsAt < b.startsAt) return -1;
    if (a.startsAt > b.startsAt) return 1;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}

function PresenterHomeSession({
  session,
  timezone,
  eventSlug,
  portalToken,
  notesEnabled,
}: {
  session: PresenterRosterSession;
  timezone: string;
  eventSlug?: string;
  portalToken?: string;
  notesEnabled: boolean;
}) {
  const formatLabel = formatChipLabel(session);
  const zoom = session.zoomLink?.trim() || "";
  const papers = session.items ?? [];
  return (
    <>
      <h3 className="text-h3 presenter-session-title">{session.title}</h3>
      <p className="text-meta" style={{ margin: 0, overflowWrap: "anywhere" }}>
        {sessionTimeLine(session.startsAt, session.endsAt, timezone)}
      </p>
      {session.roomName ? (
        <p className="text-meta" style={{ margin: 0, overflowWrap: "anywhere" }}>
          {session.roomName}
        </p>
      ) : null}
      {session.trackName || formatLabel ? (
        <p className="session-peek-track-row presenter-chip-row" style={{ margin: 0 }}>
          {session.trackName ? (
            <span
              className="session-peek-track"
              style={session.trackColor ? { ["--track-color" as string]: session.trackColor } : undefined}
            >
              <span className="session-peek-track-dot" aria-hidden />
              {session.trackName}
            </span>
          ) : null}
          {formatLabel ? <span className="session-peek-format">{formatLabel}</span> : null}
        </p>
      ) : null}
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
      <RosterHeadline session={session} />
      {session.joinedCount === 0 ? (
        <p style={{ margin: 0 }}>{PRESENTER_ROSTER_EMPTY}</p>
      ) : (
        <RosterNames session={session} />
      )}
      <RelatedSessionsList related={session.related} eventSlug={eventSlug} timezone={timezone} />
      {portalToken ? (
        <PresenterNoteComposer
          session={session}
          token={portalToken}
          enabled={notesEnabled}
          timezone={timezone}
        />
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
      {eventSlug ? (
        <p className="text-meta presenter-session-links">
          <a href={`/e/${encodeURIComponent(eventSlug)}?session=${encodeURIComponent(session.id)}`}>
            Open in the conference schedule
          </a>
          <a href={`/e/${encodeURIComponent(eventSlug)}`}>Full program</a>
        </p>
      ) : null}
    </>
  );
}

export function PresenterPortalSessionsCard({
  sessions,
  timezone,
  eventSlug,
  portalToken,
  notesEnabled = true,
}: {
  sessions: PresenterRosterSession[];
  timezone: string;
  eventSlug?: string;
  portalToken?: string;
  notesEnabled?: boolean;
}) {
  if (sessions.length === 0) return null;
  const ordered = sessionsByStart(sessions);
  return (
    <div className="presenter-session-stack">
      <h2 className="text-h3" style={{ margin: 0 }}>
        {PRESENTER_PORTAL_SESSIONS_TITLE}
      </h2>
      {ordered.map((session) => (
        <section key={session.id} className="card presenter-session-card">
          <PresenterHomeSession
            session={session}
            timezone={timezone}
            eventSlug={eventSlug}
            portalToken={portalToken}
            notesEnabled={notesEnabled}
          />
        </section>
      ))}
    </div>
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
