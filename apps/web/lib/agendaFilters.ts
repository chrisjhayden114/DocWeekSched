/**
 * Client-side agenda filter / search / now-next helpers.
 *
 * AGENDA-2 widened this from "one track, one room, one day" to the filter set
 * an attendee actually reaches for on a multi-track program, and moved the
 * whole thing into the URL. Two rules hold the model together:
 *
 *   OR within a group, AND across groups.
 *     Ticking Workshop and Panel means "either"; ticking Workshop and then
 *     picking Hall A means "both". This is what every faceted filter does, and
 *     the alternative — AND within a group — can only ever return nothing,
 *     since no session is two formats at once.
 *
 *   An empty group is not a filter.
 *     `formats: []` means "all formats", not "no formats". Every group starts
 *     empty, so the default state is the whole program.
 *
 * Everything here is pure and page-agnostic on purpose: the public page and the
 * in-app dashboard hold different session shapes (names vs ids, a nested
 * roster vs a flat one), and both have to filter identically or a shared link
 * would resolve to different sessions depending on who opened it.
 */

import type { ParsedUrlQuery } from "querystring";
import { asSessionFormat } from "@event-app/shared";

export type FilterableSession = {
  id: string;
  title: string;
  description?: string | null;
  location?: string | null;
  speakers?: string | null;
  startsAt: string;
  endsAt: string;
  trackId?: string | null;
  roomId?: string | null;
  track?: { id: string; name: string; color?: string } | null;
  room?: { id: string; name: string } | null;
  items?: Array<{ title: string; authors?: Array<{ name: string }> }>;
  speaker?: { name: string } | null;
  /** AGENDA-2 — one of SESSION_FORMATS, or null/absent when never set. */
  format?: string | null;
  /**
   * AGENDA-2 — the linked roster, in whichever shape the page has it. The
   * in-app agenda gets `sessionSpeakers` straight from GET /sessions; the
   * public page flattens its payload into `speakerPeople`. Reading both here
   * is what lets one speaker filter serve both pages.
   */
  sessionSpeakers?: Array<{ speaker: { id: string; name: string } }> | null;
  speakerPeople?: Array<{ id?: string | null; name: string }> | null;
  /** AGENDA-2 — the three columns "has slides or materials" looks at. */
  fileUrl?: string | null;
  fileLink?: string | null;
  recordingUrl?: string | null;
};

export type AgendaFilters = {
  /** Single: an agenda is read one day at a time. */
  dayKey: string | null;
  /** Multi. */
  formats: string[];
  /** Multi. Track *ids* in-app, track *names* on the public page (see module note). */
  trackIds: string[];
  /** Multi. */
  roomIds: string[];
  /** Single: "sessions with this person", not a set-of-people query. */
  speakerId: string | null;
  /** fileUrl, fileLink, or recordingUrl present. */
  hasMaterials: boolean;
  /** In-app only — the public page has no schedule to compare against. */
  mySchedule: boolean;
  query: string;
};

export const EMPTY_AGENDA_FILTERS: AgendaFilters = {
  dayKey: null,
  formats: [],
  trackIds: [],
  roomIds: [],
  speakerId: null,
  hasMaterials: false,
  mySchedule: false,
  query: "",
};

/**
 * "Clear all" keeps the day.
 *
 * The day is a place in the program, not a narrowing of it — an attendee on
 * Tuesday who clears their filters wants Tuesday unfiltered, not a jump back
 * to day one. It is the same reasoning that keeps the day out of the active
 * count below.
 */
export function clearAgendaFilters(filters: AgendaFilters): AgendaFilters {
  return { ...EMPTY_AGENDA_FILTERS, dayKey: filters.dayKey };
}

/** The groups a session can be filtered by, for per-option counts. */
export type AgendaFilterGroup = "format" | "track" | "room" | "speaker";

/** Materials, as the "Has slides or materials" toggle defines them. */
export function hasSessionMaterials(s: FilterableSession): boolean {
  return Boolean(s.fileUrl || s.fileLink || s.recordingUrl);
}

/**
 * A session's speaker keys: roster ids where there are any, names otherwise.
 *
 * Falling back to the name matters for older events whose sessions carry only
 * the legacy free-text `speakers` column — they have no roster row to point at,
 * so the filter's option list is built from names for them too. The option list
 * and this function must derive keys the same way or the filter silently
 * matches nothing.
 */
export function sessionSpeakerKeys(s: FilterableSession): string[] {
  const linked = s.sessionSpeakers?.map((row) => row.speaker) ?? [];
  if (linked.length > 0) return linked.map((p) => p.id || p.name);
  const people = s.speakerPeople ?? [];
  if (people.length > 0) return people.map((p) => p.id || p.name);
  if (s.speaker?.name) return [s.speaker.name];
  return (s.speakers || "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
}

export function sessionSearchBlob(s: FilterableSession): string {
  const parts = [
    s.title,
    s.description,
    s.location,
    s.speakers,
    s.speaker?.name,
    s.track?.name,
    s.room?.name,
    ...(s.speakerPeople || []).map((p) => p.name),
    ...(s.sessionSpeakers || []).map((row) => row.speaker.name),
    ...(s.items || []).flatMap((it) => [it.title, ...(it.authors || []).map((a) => a.name)]),
  ];
  return parts.filter(Boolean).join(" ").toLowerCase();
}

export type FilterContext = {
  /** ISO → day key ("2026-06-08"), in whichever timezone the page is showing. */
  dayKey: (iso: string) => string;
  /** In-app: the sessions this user is JOINING. Absent on the public page. */
  mySessionIds?: ReadonlySet<string>;
};

/**
 * One group's predicate, kept separate from `filterSessions` so per-option
 * counts can re-run every group *except* the one being counted.
 */
function matchesGroup(s: FilterableSession, filters: AgendaFilters, group: AgendaFilterGroup): boolean {
  // A session with no value in a group can never satisfy a selection in it:
  // "track = Workshops" must not return the untracked coffee break. Matching
  // on the empty key would do exactly that, since `s.trackId || ""` and a
  // stray `?track=` both collapse to "".
  const selected =
    group === "format"
      ? filters.formats
      : group === "track"
        ? filters.trackIds
        : group === "room"
          ? filters.roomIds
          : filters.speakerId
            ? [filters.speakerId]
            : [];
  if (selected.length === 0) return true;
  const own = (
    group === "format"
      ? [s.format]
      : group === "track"
        ? [s.trackId]
        : group === "room"
          ? [s.roomId]
          : sessionSpeakerKeys(s)
  ).filter((key): key is string => Boolean(key));
  return own.some((key) => selected.includes(key));
}

/** The filters that are not one of the four countable option groups. */
function matchesRest(s: FilterableSession, filters: AgendaFilters, ctx: FilterContext): boolean {
  if (filters.dayKey && ctx.dayKey(s.startsAt) !== filters.dayKey) return false;
  if (filters.hasMaterials && !hasSessionMaterials(s)) return false;
  // An in-app-only filter on a page with no schedule would hide everything;
  // absent mySessionIds means "this page does not have that concept".
  if (filters.mySchedule && ctx.mySessionIds && !ctx.mySessionIds.has(s.id)) return false;
  const q = filters.query.trim().toLowerCase();
  if (q && !sessionSearchBlob(s).includes(q)) return false;
  return true;
}

export function filterSessions<T extends FilterableSession>(
  sessions: readonly T[],
  filters: AgendaFilters,
  ctx: FilterContext,
): T[] {
  return sessions.filter(
    (s) =>
      matchesRest(s, filters, ctx) &&
      matchesGroup(s, filters, "format") &&
      matchesGroup(s, filters, "track") &&
      matchesGroup(s, filters, "room") &&
      matchesGroup(s, filters, "speaker"),
  );
}

/**
 * How many sessions each option in one group would match.
 *
 * Every *other* group's filters apply, but the counted group's own do not.
 * That asymmetry is the whole point of a faceted count: if selecting
 * "Workshop" also filtered the format counts, every unselected format would
 * read 0 and the numbers would stop being a reason to click anything. With the
 * group excluded, "Panel · 4" still tells you what switching would get you.
 */
export function optionCounts(
  sessions: readonly FilterableSession[],
  filters: AgendaFilters,
  ctx: FilterContext,
  group: AgendaFilterGroup,
): Map<string, number> {
  const others: AgendaFilterGroup[] = (["format", "track", "room", "speaker"] as const).filter(
    (g) => g !== group,
  );
  const counts = new Map<string, number>();
  for (const s of sessions) {
    if (!matchesRest(s, filters, ctx)) continue;
    if (!others.every((g) => matchesGroup(s, filters, g))) continue;
    const keys =
      group === "format"
        ? [s.format || ""]
        : group === "track"
          ? [s.trackId || ""]
          : group === "room"
            ? [s.roomId || ""]
            : sessionSpeakerKeys(s);
    for (const key of new Set(keys)) {
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

/** The keys one group takes across a session set, and whether any session has none. */
export function groupKeyCoverage(
  sessions: readonly FilterableSession[],
  group: AgendaFilterGroup,
): { keys: string[]; anyMissing: boolean } {
  const keys = new Set<string>();
  let anyMissing = false;
  for (const s of sessions) {
    const own =
      group === "format"
        ? [s.format || ""]
        : group === "track"
          ? [s.trackId || ""]
          : group === "room"
            ? [s.roomId || ""]
            : sessionSpeakerKeys(s);
    const present = own.filter(Boolean);
    if (present.length === 0) anyMissing = true;
    for (const key of present) keys.add(key);
  }
  return { keys: [...keys], anyMissing };
}

/**
 * Whether a group deserves a section in the rail.
 *
 * A filter that cannot remove anything is worse than no filter: it takes up a
 * screenful of rail, invites a click, and answers with the same list. So a
 * group needs either two options to choose between, or one option plus some
 * sessions that lack it — "Workshop" is a real filter on a program where half
 * the rows have no format, and a no-op on one where every row is a workshop.
 *
 * This is deliberately computed from the *unfiltered* program, so sections do
 * not appear and vanish underneath the pointer as other filters change.
 */
export function isGroupFilterable(
  sessions: readonly FilterableSession[],
  group: AgendaFilterGroup,
): boolean {
  const { keys, anyMissing } = groupKeyCoverage(sessions, group);
  return keys.length > 1 || (keys.length === 1 && anyMissing);
}

/**
 * Badge on the mobile "Filters" button.
 *
 * The day is excluded (AGENDA-1's rule, kept): it is always set to something,
 * so counting it would mean the badge never reads zero and stopped meaning
 * "you have narrowed this". Multi-select groups count each ticked value rather
 * than one per group, so removing one of three tracks visibly moves the number.
 */
export function activeFilterCount(filters: AgendaFilters): number {
  return (
    filters.formats.length +
    filters.trackIds.length +
    filters.roomIds.length +
    (filters.speakerId ? 1 : 0) +
    (filters.hasMaterials ? 1 : 0) +
    (filters.mySchedule ? 1 : 0) +
    (filters.query.trim() ? 1 : 0)
  );
}

export function hasActiveFilters(filters: AgendaFilters): boolean {
  return activeFilterCount(filters) > 0;
}

/* ------------------------------------------------------------------ *
 * URL state
 * ------------------------------------------------------------------ */

/**
 * Filters live in the query string so a narrowed agenda is a shareable link
 * and survives a refresh — "here are the three workshops I'm going to" is a
 * message people send each other, and before this it could only be described.
 *
 * Only non-default keys are emitted, so an unfiltered agenda has a clean URL
 * and `router.replace` does not churn history on first paint.
 */
/**
 * The query keys this model owns. Anything else in the URL belongs to the page
 * (`slug`, `tab`, a deep-linked conversation) and has to survive a filter
 * change untouched.
 */
export const FILTER_QUERY_KEYS = [
  "day",
  "format",
  "track",
  "room",
  "speaker",
  "materials",
  "mine",
  "q",
] as const;

export function filtersToQuery(filters: AgendaFilters): Record<string, string> {
  const query: Record<string, string> = {};
  if (filters.dayKey) query.day = filters.dayKey;
  if (filters.formats.length) query.format = filters.formats.join(",");
  if (filters.trackIds.length) query.track = filters.trackIds.join(",");
  if (filters.roomIds.length) query.room = filters.roomIds.join(",");
  if (filters.speakerId) query.speaker = filters.speakerId;
  if (filters.hasMaterials) query.materials = "1";
  if (filters.mySchedule) query.mine = "1";
  if (filters.query.trim()) query.q = filters.query.trim();
  return query;
}

function oneParam(value: string | string[] | undefined): string {
  // Next hands back an array when a key repeats (?day=a&day=b). Take the first
  // rather than joining, so a hand-edited URL degrades to something valid.
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function listParam(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value.join(",") : value ?? "";
  // De-duplicated: ?track=a,a is one selection, and a doubled value would
  // otherwise double that track's contribution to the active count.
  return [...new Set(raw.split(",").map((v) => v.trim()).filter(Boolean))];
}

/**
 * Read filters back out of a query string.
 *
 * Unknown formats are dropped rather than kept: the vocabulary is closed, so
 * `?format=roundtable` is either a typo or a stale link, and carrying it would
 * put a row in the rail that matches nothing and cannot be labelled.
 */
export function filtersFromQuery(query: ParsedUrlQuery): AgendaFilters {
  return {
    dayKey: oneParam(query.day) || null,
    formats: listParam(query.format)
      .map((f) => asSessionFormat(f))
      .filter((f): f is NonNullable<typeof f> => Boolean(f)),
    trackIds: listParam(query.track),
    roomIds: listParam(query.room),
    speakerId: oneParam(query.speaker) || null,
    hasMaterials: oneParam(query.materials) === "1",
    mySchedule: oneParam(query.mine) === "1",
    query: oneParam(query.q),
  };
}

/**
 * The line under the print header saying what is on the page.
 *
 * A printed agenda leaves the browser and loses every cue that it was
 * filtered — no rail, no chips, no URL. Someone finds it on a table and reads
 * it as the program. Stating the counts is the cheapest possible fix, and it
 * has to name the total too: "7 sessions" alone is indistinguishable from a
 * seven-session event.
 */
export function printCountLine(shown: number, total: number): string {
  const sessions = (n: number) => `${n} session${n === 1 ? "" : "s"}`;
  return shown === total
    ? `All ${sessions(total)}`
    : `Filtered: ${shown} of ${sessions(total)}`;
}

/** Toggle one value in a multi-select group, preserving selection order. */
export function toggleFilterValue(values: readonly string[], value: string): string[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}

/** Sessions happening now or the next upcoming one (by startsAt). */
export function nowAndNext(
  sessions: FilterableSession[],
  now = new Date(),
): { now: FilterableSession[]; next: FilterableSession | null } {
  const t = now.getTime();
  const happening = sessions.filter((s) => {
    const a = new Date(s.startsAt).getTime();
    const b = new Date(s.endsAt).getTime();
    return a <= t && t < b;
  });
  const upcoming = sessions
    .filter((s) => new Date(s.startsAt).getTime() > t)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  return { now: happening, next: upcoming[0] || null };
}

/** True if two intervals overlap (half-open). */
export function intervalsOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const as = new Date(aStart).getTime();
  const ae = new Date(aEnd).getTime();
  const bs = new Date(bStart).getTime();
  const be = new Date(bEnd).getTime();
  return as < be && bs < ae;
}

export function overlappingSessionIds(sessions: FilterableSession[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < sessions.length; i++) {
    for (let j = i + 1; j < sessions.length; j++) {
      if (intervalsOverlap(sessions[i].startsAt, sessions[i].endsAt, sessions[j].startsAt, sessions[j].endsAt)) {
        out.add(sessions[i].id);
        out.add(sessions[j].id);
      }
    }
  }
  return out;
}
