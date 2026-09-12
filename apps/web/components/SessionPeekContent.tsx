/**
 * AGENDA-1 — the session peek body, rendered once and used by both peek
 * surfaces: SessionPeekPopover (desktop, anchored beside the card) and
 * SessionPeekSheet (touch / narrow, bottom sheet).
 *
 * Everything an attendee needs to act on a session without leaving the agenda,
 * top to bottom: action bar, title, meta, room (→ venue map), description,
 * speakers, papers, materials, footer. All formatting decisions live in
 * lib/sessionPeek.ts so they are unit-testable; this file is layout and state.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  PEEK_ACTION_LABEL,
  paperAuthors,
  peekMaterials,
  peekMetaParts,
  peekPrimaryAction,
  peekSpeakerList,
  peekSpeakers,
  speakerCredit,
  speakerInitials,
  type PeekMaterialKind,
  type PeekPaper,
  type PeekSpeaker,
} from "../lib/sessionPeek";

export type AgendaJoinMode = "VIRTUAL" | "IN_PERSON" | "ASYNC";

/** How long "Copied" stays on the Link button before it reverts. */
export const PEEK_COPIED_MS = 1500;

/** Lines of description shown before the inline "More". */
export const PEEK_DESC_LINES = 6;

export type PeekSession = {
  id: string;
  title: string;
  description?: string | null;
  location?: string | null;
  roomId?: string | null;
  room?: { id: string; name: string } | null;
  trackId?: string | null;
  track?: { id?: string; name: string; color?: string | null } | null;
  /**
   * Linked people (in-app `GET /sessions`, or the public payload's per-session
   * array) or the legacy free-text blob. See `peekSpeakerList`.
   */
  speakers?: PeekSpeaker[] | string | null;
  speaker?: { name: string } | null;
  sessionSpeakers?: Array<{ speaker: PeekSpeaker }> | null;
  items?: PeekPaper[] | null;
  startsAt: string;
  endsAt: string;
  allowVirtualJoin?: boolean | null;
  fileUrl?: string | null;
  fileLink?: string | null;
  recordingUrl?: string | null;
  zoomLink?: string | null;
};

export type SessionPeekContentProps = {
  session: PeekSession;
  timeZone: string;
  /** Id for the <h3>, so the surface can point aria-labelledby at it. */
  titleId?: string;
  /** Public event page: browsing, not joined — no schedule actions exist yet. */
  isPublic?: boolean;
  /** Event-level speaker roster, joined by id for photos and credits. */
  speakerRoster?: readonly PeekSpeaker[] | null;
  /** Resolved track color (lib/trackColors) for the meta chip's dot and tint. */
  trackColor?: string | null;

  /** URL the "Link" action copies. */
  shareUrl: string;
  /** "Full details" target: the session page in-app, sign-in on the public page. */
  detailsHref: string;
  /** In-app: route client-side rather than following `detailsHref`. */
  onOpenDetails?: () => void;

  joined?: boolean;
  joinMode?: AgendaJoinMode | null;
  /** Capacity reached — the primary action becomes "Join waitlist". */
  full?: boolean;
  /** This session is one option in a pick-one slot. */
  pickOne?: boolean;
  starred?: boolean;
  joinBusy?: boolean;
  /** Footer chip, e.g. "Full — waitlist" or "12 of 40 seats taken". */
  capacityNote?: string | null;

  /** SINGLE-STEP join (patches IN_PERSON directly). Resolve false to surface the inline error. */
  onJoin?: () => Promise<boolean | void> | void;
  onLeave?: () => Promise<boolean | void> | void;
  onChangeMode?: (mode: AgendaJoinMode) => Promise<boolean | void> | void;
  /** Pick-one slot: goes through the slot's replace-confirm. */
  onChoose?: () => Promise<boolean | void> | void;
  onToggleStar?: () => void;
  /** Venue map deep link for the room, when venue_maps is on and a pin is linked. */
  roomMapHref?: string | null;
  /** In-app: focus the pin without a page load. */
  onRoomMap?: () => void;
};

function MaterialGlyph({ kind }: { kind: PeekMaterialKind }) {
  const paths: Record<PeekMaterialKind, string> = {
    // A slide deck: a frame with a baseline.
    slides: "M3 4h18v12H3z M8 20h8",
    // A document with a folded corner.
    resources: "M6 3h8l4 4v14H6z M14 3v4h4",
    // Play in a circle.
    recording: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M10 9l5 3-5 3z",
    // A camera body: the online meeting link.
    online: "M3 7h11v10H3z M14 11l7-4v10l-7-4",
  };
  return (
    <svg className="session-peek-chip-glyph" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d={paths[kind]} />
    </svg>
  );
}

function SpeakerAvatar({ person }: { person: PeekSpeaker }) {
  if (person.photoUrl) {
    return <img className="session-peek-avatar" src={person.photoUrl} alt="" />;
  }
  return (
    <span className="session-peek-avatar session-peek-avatar--initials" aria-hidden>
      {speakerInitials(person.name)}
    </span>
  );
}

export function SessionPeekContent({
  session,
  timeZone,
  titleId,
  isPublic = false,
  speakerRoster,
  trackColor,
  shareUrl,
  detailsHref,
  onOpenDetails,
  joined = false,
  joinMode,
  full = false,
  pickOne = false,
  starred = false,
  joinBusy = false,
  capacityNote,
  onJoin,
  onLeave,
  onChangeMode,
  onChoose,
  onToggleStar,
  roomMapHref,
  onRoomMap,
}: SessionPeekContentProps) {
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const [descClipped, setDescClipped] = useState(false);
  const descRef = useRef<HTMLParagraphElement | null>(null);
  const copyTimer = useRef<number | null>(null);

  useEffect(() => {
    setError(null);
    setCopied(false);
    setDescExpanded(false);
  }, [session.id]);

  useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  // "More" only appears when the clamp actually hides something.
  useEffect(() => {
    const el = descRef.current;
    if (!el || descExpanded) return;
    setDescClipped(el.scrollHeight > el.clientHeight + 1);
  }, [session.id, session.description, descExpanded]);

  const run = useCallback(async (action: (() => Promise<boolean | void> | void) | undefined) => {
    if (!action) return;
    setError(null);
    const ok = await action();
    if (ok === false) setError("Couldn't save — try again");
  }, []);

  const copyLink = useCallback(() => {
    const write = navigator?.clipboard?.writeText?.(shareUrl);
    Promise.resolve(write)
      .then(() => {
        setCopied(true);
        if (copyTimer.current) window.clearTimeout(copyTimer.current);
        copyTimer.current = window.setTimeout(() => setCopied(false), PEEK_COPIED_MS);
      })
      .catch(() => setError("Couldn't copy the link"));
  }, [shareUrl]);

  const meta = peekMetaParts(session, timeZone);
  const people = peekSpeakerList(session, speakerRoster);
  const legacySpeakers = people.length === 0 ? peekSpeakers({ ...session, speakers: typeof session.speakers === "string" ? session.speakers : null }) : "";
  const materials = peekMaterials(session, { includeOnline: !isPublic });
  const papers = session.items ?? [];
  const action = peekPrimaryAction({ isPublic, joined, full, pickOne });
  // A pick-one option always routes through the slot's replace-confirm, even
  // when the label reads "Join waitlist" because the room is full.
  const primaryHandler = pickOne ? onChoose ?? onJoin : onJoin;
  const myMode: AgendaJoinMode = joinMode ?? "IN_PERSON";
  const allowsVirtual = session.allowVirtualJoin !== false;

  return (
    <div className="session-peek-body">
      {/* a. Action bar — the strip across the top, like sched.com's. */}
      <div className="session-peek-bar">
        {action === "publicJoin" ? (
          <a className="button session-peek-primary" href={detailsHref}>
            {PEEK_ACTION_LABEL.publicJoin}
          </a>
        ) : action === "joined" ? (
          <>
            <span className="session-peek-joined-pill">{PEEK_ACTION_LABEL.joined}</span>
            <button
              type="button"
              className="session-peek-leave"
              disabled={joinBusy}
              onClick={() => void run(onLeave)}
            >
              Remove
            </button>
          </>
        ) : (
          <button
            type="button"
            className="button session-peek-primary"
            disabled={joinBusy}
            onClick={() => void run(primaryHandler)}
          >
            {PEEK_ACTION_LABEL[action]}
          </button>
        )}
        <button
          type="button"
          className="session-peek-bar-btn"
          aria-live="polite"
          onClick={copyLink}
        >
          {copied ? "Copied" : "Link"}
        </button>
        {onOpenDetails ? (
          <button type="button" className="session-peek-bar-btn" onClick={onOpenDetails}>
            Full details
          </button>
        ) : (
          <a className="session-peek-bar-btn" href={detailsHref}>
            Full details
          </a>
        )}
      </div>

      {error ? (
        <p className="session-peek-error" role="alert">
          {error}
        </p>
      ) : null}

      {/* b. Title + meta line. */}
      <h3 className="session-peek-title" id={titleId}>
        {session.title}
      </h3>
      <p className="session-peek-meta">
        <span>{meta.time}</span>
        {/* c. The room links to its map pin when one is linked. */}
        {meta.room ? (
          <>
            <span className="session-peek-meta-sep" aria-hidden>
              ·
            </span>
            {onRoomMap ? (
              <button type="button" className="session-peek-room-link" onClick={onRoomMap}>
                {meta.room}
              </button>
            ) : roomMapHref ? (
              <a className="session-peek-room-link" href={roomMapHref}>
                {meta.room}
              </a>
            ) : (
              <span>{meta.room}</span>
            )}
          </>
        ) : null}
        {meta.track ? (
          <>
            <span className="session-peek-meta-sep" aria-hidden>
              ·
            </span>
            <span
              className="session-peek-track"
              style={trackColor ? { ["--track-color" as string]: trackColor } : undefined}
            >
              <span className="session-peek-track-dot" aria-hidden />
              {meta.track}
            </span>
          </>
        ) : null}
      </p>

      {/* d. Description, clamped, expanding in place. */}
      {session.description ? (
        <>
          <p
            ref={descRef}
            className={`session-peek-desc${descExpanded ? " is-expanded" : ""}`}
          >
            {session.description}
          </p>
          {descClipped && !descExpanded ? (
            <button type="button" className="session-peek-more" onClick={() => setDescExpanded(true)}>
              More
            </button>
          ) : null}
        </>
      ) : null}

      {/* e. Speakers. */}
      {people.length > 0 ? (
        <ul className="session-peek-speaker-list">
          {people.map((person, idx) => {
            const credit = speakerCredit(person);
            return (
              <li key={person.id || `${person.name}-${idx}`} className="session-peek-speaker">
                <SpeakerAvatar person={person} />
                <span className="session-peek-speaker-text">
                  <span className="session-peek-speaker-name">{person.name}</span>
                  {credit ? <span className="session-peek-speaker-credit">{credit}</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : legacySpeakers ? (
        <p className="session-peek-speakers">{legacySpeakers}</p>
      ) : null}

      {/* f. Papers. */}
      {papers.length > 0 ? (
        <ul className="session-peek-papers">
          {papers.map((paper, idx) => {
            const authors = paperAuthors(paper);
            return (
              <li key={paper.id || `${paper.title}-${idx}`} className="session-peek-paper">
                <span className="session-peek-paper-title">{paper.title}</span>
                {authors.length > 0 ? (
                  <span className="session-peek-paper-authors">
                    {authors.map((author, i) => (
                      <span key={`${author.name}-${i}`}>
                        {i > 0 ? ", " : ""}
                        {author.isPresenter ? <strong>{author.name}</strong> : author.name}
                      </span>
                    ))}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {/* g. Materials. Hidden when the session has none. */}
      {materials.length > 0 ? (
        <div className="session-peek-materials">
          {materials.map((material) => (
            <a
              key={material.kind}
              className="session-peek-chip"
              href={material.href}
              target="_blank"
              rel="noreferrer"
            >
              <MaterialGlyph kind={material.kind} />
              {material.label}
            </a>
          ))}
        </div>
      ) : null}

      {/* The mode switch appears only once joined — joining itself is one step. */}
      {joined && onChangeMode ? (
        <div className="join-mode-switch session-peek-mode" role="group" aria-label="Attendance mode">
          {allowsVirtual ? (
            <button
              type="button"
              className={myMode === "VIRTUAL" ? "is-active" : ""}
              disabled={joinBusy}
              onClick={() => void run(() => onChangeMode("VIRTUAL"))}
            >
              Virtual
            </button>
          ) : null}
          <button
            type="button"
            className={myMode === "IN_PERSON" ? "is-active" : ""}
            disabled={joinBusy}
            onClick={() => void run(() => onChangeMode("IN_PERSON"))}
          >
            In person
          </button>
          <button
            type="button"
            className={myMode === "ASYNC" ? "is-active" : ""}
            disabled={joinBusy}
            title="Asynchronous — join across time zones"
            onClick={() => void run(() => onChangeMode("ASYNC"))}
          >
            Async
          </button>
        </div>
      ) : null}

      {/* h. Footer: capacity, then the star. */}
      {capacityNote || onToggleStar ? (
        <div className="session-peek-foot">
          {capacityNote ? (
            <span className="schedule-option-chip session-waitlist-chip">{capacityNote}</span>
          ) : null}
          {onToggleStar ? (
            <button
              type="button"
              className={`session-peek-star${starred ? " is-active" : ""}`}
              aria-pressed={starred}
              title={starred ? "Remove star (session starting soon alerts)" : "Star for reminders"}
              onClick={onToggleStar}
            >
              {starred ? "Starred" : "Star"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
