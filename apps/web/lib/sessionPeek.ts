/**
 * Pure formatting helpers for the session peek surfaces (Chunk H4 / D6,
 * extended for AGENDA-1's anchored popover).
 *
 * Kept out of the components so the time·room·track line, the speaker roster
 * join, the materials row and the primary-action rules are unit-testable.
 */

import { formatEventTimeRange } from "./dateFormat";

export type PeekMetaSession = {
  startsAt: string;
  endsAt: string;
  location?: string | null;
  room?: { name: string } | null;
  track?: { name: string } | null;
};

/**
 * The meta line's three parts, so the popover can render the track as a
 * colored chip while `peekMeta` still produces one plain string.
 */
export type PeekMetaParts = {
  /** "Mon, Jun 8 · 9:00 AM – 10:30 AM EDT" — always present. */
  time: string;
  /** Linked room, else the free-text location. */
  room: string | null;
  track: string | null;
};

export function peekMetaParts(session: PeekMetaSession, timeZone: string): PeekMetaParts {
  return {
    time: formatEventTimeRange(session.startsAt, session.endsAt, timeZone),
    room: session.room?.name || session.location || null,
    track: session.track?.name || null,
  };
}

/** "Mon, Jun 8 · 9:00 AM – 10:30 AM EDT · Room 2 · AI Track" — missing parts drop out. */
export function peekMeta(session: PeekMetaSession, timeZone: string): string {
  const { time, room, track } = peekMetaParts(session, timeZone);
  return [time, room, track].filter(Boolean).join(" · ");
}

/** Speakers line: the free-text speakers field wins over the single linked speaker. */
export function peekSpeakers(session: { speakers?: string | null; speaker?: { name: string } | null }): string {
  return session.speakers?.trim() || session.speaker?.name || "";
}

/* ------------------------------------------------------------------ *
 * AGENDA-1 — speakers, papers, materials, and the primary action
 * ------------------------------------------------------------------ */

/** One resolved speaker card: a photo or initials, a name, and one credit line. */
export type PeekSpeaker = {
  id?: string | null;
  name: string;
  title?: string | null;
  affiliation?: string | null;
  photoUrl?: string | null;
  bio?: string | null;
};

export type PeekSpeakerSource = {
  /** In-app: `GET /sessions` nests the linked roster rows here. */
  sessionSpeakers?: Array<{ speaker: PeekSpeaker }> | null;
  /** Public payload: per-session speakers, thin until joined to the roster. */
  speakers?: PeekSpeaker[] | string | null;
  speaker?: { name: string } | null;
};

/**
 * Resolve the speakers to render, in preference order:
 *   1. linked `sessionSpeakers` (in-app — already carries photos and credits),
 *   2. a public payload's `speakers[]` array, enriched from the event-level
 *      roster by id so the popover picks up photoUrl / bio,
 *   3. nothing — the caller falls back to the legacy free-text line.
 *
 * The legacy `speakers` *string* deliberately yields `[]`: it is one opaque
 * blob ("Dr. A, Dr. B"), not people we can render avatars for.
 */
export function peekSpeakerList(
  session: PeekSpeakerSource,
  roster?: readonly PeekSpeaker[] | null,
): PeekSpeaker[] {
  const byId = new Map<string, PeekSpeaker>();
  for (const person of roster ?? []) {
    if (person.id) byId.set(person.id, person);
  }
  const enrich = (person: PeekSpeaker): PeekSpeaker => {
    const full = person.id ? byId.get(person.id) : undefined;
    if (!full) return person;
    return {
      ...person,
      title: person.title ?? full.title ?? null,
      affiliation: person.affiliation ?? full.affiliation ?? null,
      photoUrl: person.photoUrl ?? full.photoUrl ?? null,
      bio: person.bio ?? full.bio ?? null,
    };
  };

  const linked = session.sessionSpeakers?.map((row) => row.speaker).filter(Boolean) ?? [];
  if (linked.length > 0) return linked.map(enrich);
  if (Array.isArray(session.speakers)) return session.speakers.map(enrich);
  return [];
}

/** Avatar fallback: up to two initials, or "?" for an unusable name. */
export function speakerInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]![0] ?? "";
  const last = words.length > 1 ? words[words.length - 1]![0] ?? "" : "";
  return (first + last).toUpperCase() || "?";
}

/** "Instructional Coach, Riverside School District" — one line, missing parts drop out. */
export function speakerCredit(person: PeekSpeaker): string {
  return [person.title, person.affiliation].filter(Boolean).join(", ");
}

export type PeekPaper = {
  id?: string;
  title: string;
  authors?: Array<{ name: string; isPresenter?: boolean }> | null;
};

/** Paper authors with the presenter first-class, so the row can bold them. */
export function paperAuthors(paper: PeekPaper): Array<{ name: string; isPresenter: boolean }> {
  return (paper.authors ?? []).map((a) => ({ name: a.name, isPresenter: Boolean(a.isPresenter) }));
}

/** File-type glyph shown on a materials chip and on the card's "has slides" hint. */
export type PeekMaterialKind = "slides" | "resources" | "recording" | "online";

export type PeekMaterial = {
  kind: PeekMaterialKind;
  label: string;
  href: string;
};

export type PeekMaterialSource = {
  fileUrl?: string | null;
  fileLink?: string | null;
  recordingUrl?: string | null;
  zoomLink?: string | null;
};

/**
 * The materials row, in a fixed order. `zoomLink` is in-app only — a public
 * page must never leak a meeting URL to someone who has not joined.
 *
 * AGENDA-3 extension point: Speaker Readiness materials belong here. Append
 * them after these chips (they are per-session uploads with the same shape:
 * kind + label + href), so the row's layout and the "hidden when empty" rule
 * keep working without touching any caller.
 */
export function peekMaterials(session: PeekMaterialSource, opts?: { includeOnline?: boolean }): PeekMaterial[] {
  const out: PeekMaterial[] = [];
  if (session.fileUrl) out.push({ kind: "slides", label: "Slides", href: session.fileUrl });
  if (session.fileLink) out.push({ kind: "resources", label: "Resources", href: session.fileLink });
  if (session.recordingUrl) out.push({ kind: "recording", label: "Recording", href: session.recordingUrl });
  if (opts?.includeOnline && session.zoomLink) {
    out.push({ kind: "online", label: "Join online", href: session.zoomLink });
  }
  return out;
}

/** Which primary action the peek's action bar offers. */
export type PeekActionKind = "publicJoin" | "joined" | "waitlist" | "chooseOne" | "join";

/**
 * Primary-action rules, in precedence order:
 *   public page  → sign in first, there is no schedule to add to yet;
 *   joined       → "Added ✓" with a Remove beside it;
 *   full         → "Join waitlist" — capacity is stated before it is hit, never
 *                  after a click fails, even inside a pick-one slot;
 *   pick-one     → "Choose this session" (the slot replaces, it does not stack);
 *   otherwise    → "Add to my schedule".
 *
 * `full` deliberately outranks `pickOne` so the label stays honest; the click
 * still routes through the slot's replace-confirm (see SessionPeekContent).
 */
export function peekPrimaryAction(input: {
  isPublic?: boolean;
  joined?: boolean;
  full?: boolean;
  pickOne?: boolean;
}): PeekActionKind {
  if (input.isPublic) return "publicJoin";
  if (input.joined) return "joined";
  if (input.full) return "waitlist";
  if (input.pickOne) return "chooseOne";
  return "join";
}

export const PEEK_ACTION_LABEL: Record<PeekActionKind, string> = {
  publicJoin: "Join to build your schedule",
  joined: "Added ✓",
  waitlist: "Join waitlist",
  chooseOne: "Choose this session",
  join: "Add to my schedule",
};

/** In-app path to a session's own page. */
export function sessionDetailPath(sessionId: string): string {
  return `/session/${sessionId}`;
}

/** DOM id of a public agenda card, so a copied link can scroll straight to it. */
export function publicSessionAnchorId(sessionId: string): string {
  return `session-${sessionId}`;
}

/**
 * Public deep link to one session on the event page. `/session/:id` needs an
 * account, so the copyable link for a browsing visitor is the agenda card.
 */
export function publicSessionPath(slug: string, sessionId: string): string {
  return `/e/${slug}#${publicSessionAnchorId(sessionId)}`;
}

/** Absolute URL the "Link" action copies. Falls back to the path when there is no origin. */
export function sessionShareUrl(path: string, origin?: string | null): string {
  return origin ? `${origin.replace(/\/+$/, "")}${path}` : path;
}
