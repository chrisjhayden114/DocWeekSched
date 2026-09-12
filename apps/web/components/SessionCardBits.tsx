/**
 * AGENDA-1 — small pieces of a session card, shared by the public agenda and
 * the in-app one so both cards read the same at a glance.
 *
 * The card stays a summary: who is speaking (faces, not a wrapped name list)
 * and whether there is anything to download. Everything else is one hover away
 * in the session peek.
 */

import { speakerInitials, type PeekSpeaker } from "../lib/sessionPeek";

/** Faces shown before the row collapses into "+N". */
export const CARD_AVATAR_LIMIT = 3;

/**
 * Speaker avatars on a card: photo when there is one, initials otherwise, and
 * "+2" past the limit so the row height never depends on the speaker count.
 */
export function CardSpeakerAvatars({ speakers }: { speakers: readonly PeekSpeaker[] }) {
  if (speakers.length === 0) return null;
  const shown = speakers.slice(0, CARD_AVATAR_LIMIT);
  const overflow = speakers.length - shown.length;
  return (
    <p className="schedule-event-speakers schedule-event-faces">
      <span className="card-avatars">
        {shown.map((person, idx) => (
          <span key={person.id || `${person.name}-${idx}`} className="card-avatar" title={person.name}>
            {person.photoUrl ? (
              <img src={person.photoUrl} alt="" />
            ) : (
              <span aria-hidden>{speakerInitials(person.name)}</span>
            )}
          </span>
        ))}
        {overflow > 0 ? <span className="card-avatar card-avatar--more">{`+${overflow}`}</span> : null}
      </span>
      <span className="card-avatar-names">{speakers.map((sp) => sp.name).join(", ")}</span>
    </p>
  );
}

/** Quiet "this session has slides / materials" hint. Never a link — the peek has those. */
export function CardMaterialsHint({ label = "Slides" }: { label?: string }) {
  return (
    <span className="card-materials-hint">
      <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M3 4h18v12H3z M8 20h8" />
      </svg>
      {label}
    </span>
  );
}
