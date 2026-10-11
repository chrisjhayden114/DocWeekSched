/**
 * PRESENTER-ROSTER-1 — view-model helpers for the presenter portal card
 * and the session-page panel. Copy lives here so help tests can assert
 * against the same strings the components render.
 */

import {
  PRESENTER_NOTE_MAX_CHARS,
  type PresenterRosterAttendee,
  type PresenterRosterSession,
} from "@event-app/shared";

export const PRESENTER_PORTAL_SESSIONS_TITLE = "Your sessions";
export const SESSION_PAGE_PRESENTER_ROSTER_TITLE = "You're presenting this session";
export const PRESENTER_ROSTER_EMPTY = "Nobody has added this session yet.";
export const PRESENTER_ROSTER_PAGE_SIZE = 24;
export const PRESENTER_ROSTER_SHOW_MORE = "Show 24 more";
export const PRESENTER_ROSTER_SORT_AFFILIATION = "Sort by affiliation";
export const PRESENTER_ROSTER_SEARCH_PLACEHOLDER =
  "Search by name, school, role, or anything in their profile";
export const PRESENTER_ROSTER_TRUNCATED = "Showing the first 500";
export const PRESENTER_NOTES_HEADING = "From the presenter";
export const PRESENTER_NOTES_TO_ATTENDEES = "Notes to attendees";
export const SESSIONS_LIKE_YOURS = "Sessions like yours";
export const RUNS_AT_THE_SAME_TIME = "Runs at the same time as yours";
export const PRESENTER_NOTE_COMPOSER_LABEL = "Send a note to everyone who joined";
export const PRESENTER_NOTE_SEND = "Send";

export function presenterNoteCountLabel(length: number): string {
  return `${length} of ${PRESENTER_NOTE_MAX_CHARS}`;
}
export const PRESENTER_NOTE_HELP =
  "Everyone who joined gets this as a notification. For one-to-one messages, sign in with the email this link was sent to and use Messages.";
export const PRESENTER_NOTES_SETTING_LABEL =
  "Presenters can send notes to attendees who joined their session";

export function presenterRosterSeats(session: Pick<
  PresenterRosterSession,
  "inPersonCapacity" | "virtualCapacity"
>): number | null {
  const parts = [session.inPersonCapacity, session.virtualCapacity].filter(
    (n): n is number => typeof n === "number" && n > 0,
  );
  if (parts.length === 0) return null;
  return parts.reduce((sum, n) => sum + n, 0);
}

export function presenterRosterJoinedLine(
  session: Pick<PresenterRosterSession, "joinedCount" | "inPersonCapacity" | "virtualCapacity">,
): string {
  const seats = presenterRosterSeats(session);
  if (seats != null) return `${session.joinedCount} of ${seats} seats`;
  return `${session.joinedCount} joined`;
}

export function presenterRosterWaitlistLine(waitlistCount: number): string | null {
  if (waitlistCount <= 0) return null;
  return `+${waitlistCount} waiting`;
}

export function presenterRosterHiddenLine(hiddenCount: number): string | null {
  if (hiddenCount <= 0) return null;
  const who = hiddenCount === 1 ? "1 more who keeps" : `${hiddenCount} more who keep`;
  return `and ${who} their profile private`;
}

export function presenterRosterHeadline(
  session: Pick<PresenterRosterSession, "joinedCount" | "waitlistCount" | "inPersonCapacity" | "virtualCapacity">,
): string {
  const seats = presenterRosterSeats(session);
  const parts = [`${session.joinedCount} joined`];
  if (seats != null) parts.push(`${seats} seats`);
  parts.push(`${session.waitlistCount} waiting`);
  return parts.join(" · ");
}

export function presenterRosterNamesShownLine(shown: number, hidden: number): string {
  return `${shown} names shown, ${hidden} keep their profile private`;
}

export function presenterRosterMatchesQuery(person: PresenterRosterAttendee, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [person.displayName, person.title, person.affiliation, person.bio]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join("\n")
    .toLowerCase();
  return haystack.includes(needle);
}

function byDisplayName(a: PresenterRosterAttendee, b: PresenterRosterAttendee): number {
  return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
}

/** Name order, or affiliation groups (blank affiliation last) with name inside each group. */
export function sortPresenterRosterAttendees(
  people: readonly PresenterRosterAttendee[],
  mode: "name" | "affiliation",
): PresenterRosterAttendee[] {
  const copy = [...people];
  if (mode === "name") return copy.sort(byDisplayName);
  return copy.sort((a, b) => {
    const aa = a.affiliation?.trim() ?? "";
    const bb = b.affiliation?.trim() ?? "";
    if (!aa && bb) return 1;
    if (aa && !bb) return -1;
    const aff = aa.localeCompare(bb, undefined, { sensitivity: "base" });
    if (aff !== 0) return aff;
    return byDisplayName(a, b);
  });
}

export function hasPresenterRosterNames(
  session: PresenterRosterSession,
): session is PresenterRosterSession & { attendees: NonNullable<PresenterRosterSession["attendees"]> } {
  return Array.isArray(session.attendees);
}
