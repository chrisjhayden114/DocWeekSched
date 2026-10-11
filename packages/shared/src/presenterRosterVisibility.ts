/**
 * PRESENTER-ROSTER-1 — what a presenter may see about people who joined
 * their sessions.
 *
 * The column on "Event" is a plain String, exactly like materialsVisibility:
 * the vocabulary is closed HERE rather than in the database so widening it
 * later is a code deploy instead of a migration that locks the Event table,
 * and so an old pod mid-rolling-deploy can never reject a value a new pod
 * just wrote.
 *
 * Three values:
 *   OFF    — presenters see nothing. The portal route 404s; the session-page
 *            panel is not shown.
 *   COUNTS — joined count, capacity, and waitlist count per session. No names.
 *            The default, and the value every existing event reads.
 *   NAMES  — counts plus the names of attendees who have joined AND opted
 *            into the attendee directory. Everyone else is counted, not named.
 *
 * Unrecognised values collapse to COUNTS: that is the documented default, and
 * it never leaks a name. NAMES is the only value that may attach an attendees
 * array.
 */

export const PRESENTER_ROSTER_VISIBILITIES = ["OFF", "COUNTS", "NAMES"] as const;

export type PresenterRosterVisibility = (typeof PRESENTER_ROSTER_VISIBILITIES)[number];

/** Every event starts here, including every existing row. */
export const DEFAULT_PRESENTER_ROSTER_VISIBILITY: PresenterRosterVisibility = "COUNTS";

/** Label for the organizer's select. */
export const PRESENTER_ROSTER_VISIBILITY_LABELS: Record<PresenterRosterVisibility, string> = {
  OFF: "Nothing — hide the list",
  COUNTS: "How many people joined",
  NAMES: "Names of people who joined",
};

/**
 * Plain-language consequence, shown under the select. The NAMES help is the
 * one sentence the organizer setting also uses as its standing explanation.
 */
export const PRESENTER_ROSTER_VISIBILITY_HELP: Record<PresenterRosterVisibility, string> = {
  OFF: "Presenters will not see who added their sessions, or even how many people did.",
  COUNTS:
    "Presenters see how many people joined each of their sessions, the capacity if you set one, and how many are waiting. No names.",
  NAMES:
    "Presenters see the counts, plus the names of attendees who are visible in the attendee directory. Everyone else is counted but not named.",
};

/** Standing help under the organizer select — true for every option. */
export const PRESENTER_ROSTER_VISIBILITY_SETTING_HELP =
  "Presenters open this from their personal link. Names come only from attendees who are visible in the attendee directory; everyone else is counted but not named.";

export const PRESENTER_ROSTER_VISIBILITY_SETTING_TITLE = "What presenters can see about their sessions";

export type PresenterRosterAttendee = {
  displayName: string;
  affiliation?: string;
};

export type PresenterRosterSession = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  roomName: string | null;
  joinedCount: number;
  inPersonCapacity: number | null;
  virtualCapacity: number | null;
  waitlistCount: number;
  /** Present only when visibility is NAMES. */
  attendees?: PresenterRosterAttendee[];
  /** Present only when visibility is NAMES — JOINING people who stay unnamed. */
  hiddenCount?: number;
};

/**
 * Narrow an unknown value from the database or a request body. Anything the
 * app does not recognise returns null rather than passing through, so a
 * hand-edited row cannot widen access to names by accident.
 */
export function asPresenterRosterVisibility(value: unknown): PresenterRosterVisibility | null {
  return typeof value === "string" &&
    (PRESENTER_ROSTER_VISIBILITIES as readonly string[]).includes(value)
    ? (value as PresenterRosterVisibility)
    : null;
}

/**
 * The value to ACT on. Unrecognised and missing both collapse to COUNTS:
 * when we cannot tell what an event meant, we do not hand out names.
 */
export function presenterRosterVisibilityOrDefault(value: unknown): PresenterRosterVisibility {
  return asPresenterRosterVisibility(value) ?? DEFAULT_PRESENTER_ROSTER_VISIBILITY;
}

export function presenterRosterVisibilityLabel(value: unknown): string {
  return PRESENTER_ROSTER_VISIBILITY_LABELS[presenterRosterVisibilityOrDefault(value)];
}

/** Options for the organizer select, in the order they should read. */
export function presenterRosterVisibilitySelectOptions(): Array<{
  value: PresenterRosterVisibility;
  label: string;
}> {
  return PRESENTER_ROSTER_VISIBILITIES.map((value) => ({
    value,
    label: PRESENTER_ROSTER_VISIBILITY_LABELS[value],
  }));
}
