/**
 * AGENDA-2 — the session "format" vocabulary: what *kind* of thing a session
 * is, independent of its track.
 *
 * Track answers "which strand is this in" and is per-event free text. Format
 * answers "is this a keynote or a coffee break", and an attendee scanning a
 * program wants that axis far more often than they want a strand: "show me the
 * workshops", "hide the breaks". That only works if the words are the same in
 * every event, so the vocabulary is fixed and closed here.
 *
 * The column is a nullable String, not a Postgres enum. A DB enum would make
 * every future addition to this list a migration with a lock on the Session
 * table, and would let an old API pod reject a value a new one writes during a
 * rolling deploy. Validation therefore lives in Zod (API) and in these helpers
 * (web), which is where a bad value can be reported to a human anyway.
 *
 * Pure data and pure functions, shared by API and web so the organizer's
 * dropdown, the ingest inference, and the attendee's filter can never disagree
 * about what a format is called.
 */

/** The closed vocabulary, in the order it reads on a program. */
export const SESSION_FORMATS = [
  "keynote",
  "talk",
  "workshop",
  "panel",
  "lightning",
  "poster",
  "break",
  "social",
  "other",
] as const;

export type SessionFormat = (typeof SESSION_FORMATS)[number];

/** Human label for a format, used in the organizer select and the filter rail. */
export const SESSION_FORMAT_LABELS: Record<SessionFormat, string> = {
  keynote: "Keynote",
  talk: "Talk",
  workshop: "Workshop",
  panel: "Panel",
  lightning: "Lightning talk",
  poster: "Poster",
  break: "Break",
  social: "Social",
  other: "Other",
};

/**
 * Narrow an unknown value to a format. Anything unrecognized becomes null
 * rather than "other": "other" is a deliberate organizer choice, and silently
 * promoting a typo or a stale value to it would hide the mistake.
 */
export function asSessionFormat(value: unknown): SessionFormat | null {
  return typeof value === "string" && (SESSION_FORMATS as readonly string[]).includes(value)
    ? (value as SessionFormat)
    : null;
}

export function sessionFormatLabel(value: unknown): string | null {
  const format = asSessionFormat(value);
  return format ? SESSION_FORMAT_LABELS[format] : null;
}

/**
 * Title cues that let ingest set a format without asking the model to judge.
 *
 * Checked in this order, so the first cue in a title like "Keynote panel" wins
 * and the result is stable rather than dependent on object key order. Each cue
 * is whole-word: `\bbreak\b` deliberately does not fire on "Breakout", which is
 * a session, not a coffee break.
 */
const FORMAT_TITLE_CUES: ReadonlyArray<{ format: SessionFormat; pattern: RegExp }> = [
  { format: "keynote", pattern: /\bkeynotes?\b/i },
  { format: "workshop", pattern: /\bworkshops?\b/i },
  { format: "panel", pattern: /\bpanels?\b/i },
  { format: "lightning", pattern: /\blightning\b/i },
  { format: "poster", pattern: /\bposters?\b/i },
  { format: "break", pattern: /\b(?:breaks?|lunch|coffee|registration)\b/i },
  { format: "social", pattern: /\b(?:reception|social|networking)\b/i },
];

/**
 * Infer a format from a session title, or null when nothing in the title says
 * so.
 *
 * Null is the common case and that is the point: a program full of rows named
 * "Paper session 3B" carries no format information, and inventing "talk" for
 * every one of them would fill the attendee's format filter with a category the
 * organizer never chose. Ingest only sets what the source makes obvious; the
 * organizer fills in the rest.
 */
export function inferSessionFormat(title: string | null | undefined): SessionFormat | null {
  if (!title) return null;
  for (const cue of FORMAT_TITLE_CUES) {
    if (cue.pattern.test(title)) return cue.format;
  }
  return null;
}
