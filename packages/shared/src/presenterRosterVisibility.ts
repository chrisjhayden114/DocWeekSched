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
  /** Directory-visible profile fields. Omitted when the attendee left them blank. */
  title?: string;
  affiliation?: string;
  photoUrl?: string;
  /**
   * Directory-visible bio. Same rule as title and affiliation: only present
   * when this attendee is in the directory and the field is non-empty.
   */
  bio?: string;
};

/** Named attendees returned for one session. The rest set `truncated`. */
export const PRESENTER_ROSTER_ATTENDEE_CAP = 500;

export function capPresenterRosterAttendees<T>(rows: readonly T[]): {
  attendees: T[];
  truncated: boolean;
} {
  if (rows.length <= PRESENTER_ROSTER_ATTENDEE_CAP) {
    return { attendees: [...rows], truncated: false };
  }
  return { attendees: rows.slice(0, PRESENTER_ROSTER_ATTENDEE_CAP), truncated: true };
}

/** A note the presenter already sent. No speaker id, no email. */
export type PresenterRosterNote = {
  id: string;
  body: string;
  createdAt: string;
};

export const PRESENTER_NOTE_MAX_CHARS = 600;

export function presenterNoteNotificationTitle(speakerName: string, sessionTitle: string): string {
  return `Note from ${speakerName} about ${sessionTitle}`;
}

export type PresenterRosterPaper = {
  title: string;
  abstract: string | null;
  authors: Array<{ name: string; isPresenter: boolean }>;
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
  /**
   * Presenter-home detail. Set on COUNTS and NAMES responses. The portal
   * sessions route still 404s for OFF, so these never travel in that case.
   */
  description?: string | null;
  trackName?: string | null;
  trackColor?: string | null;
  format?: string | null;
  zoomLink?: string | null;
  items?: PresenterRosterPaper[];
  /** Present only when visibility is NAMES. */
  attendees?: PresenterRosterAttendee[];
  /** Present only when visibility is NAMES — JOINING people who stay unnamed. */
  hiddenCount?: number;
  /** Present only when the named list was cut at PRESENTER_ROSTER_ATTENDEE_CAP. */
  truncated?: boolean;
  /** Notes this presenter has sent, newest first. Portal sessions payload. */
  notes?: PresenterRosterNote[];
  /** PRESENTER-HOME-C — other published sessions that share vocabulary. Portal only. */
  related?: PresenterRelatedSession[];
};

/** One row of "Sessions like yours". Names only — no speaker ids, no emails. */
export type PresenterRelatedSession = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  roomName: string | null;
  speakers: string[];
  overlapsYours: boolean;
};

function emptyToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function optionalProfile(value: string | null | undefined): string | undefined {
  const trimmed = emptyToNull(value);
  return trimmed ?? undefined;
}

/**
 * One directory-visible joiner, for the presenter roster.
 * Picks name / title / affiliation / photoUrl only. Email, user id, and join
 * mode are not parameters and cannot be copied onto the result.
 */
export function shapeDirectoryVisibleAttendee(user: {
  name: string | null;
  title?: string | null;
  affiliation?: string | null;
  photoUrl?: string | null;
  bio?: string | null;
}): PresenterRosterAttendee {
  const row: PresenterRosterAttendee = {
    displayName: emptyToNull(user.name) ?? "Attendee",
  };
  const title = optionalProfile(user.title);
  const affiliation = optionalProfile(user.affiliation);
  const photoUrl = optionalProfile(user.photoUrl);
  const bio = optionalProfile(user.bio);
  if (title) row.title = title;
  if (affiliation) row.affiliation = affiliation;
  if (photoUrl) row.photoUrl = photoUrl;
  if (bio) row.bio = bio;
  return row;
}

/** Speaker row for GET /portal/:token. No id, no email. */
export function shapePortalSpeaker(speaker: {
  name: string;
  title: string | null;
  affiliation: string | null;
  bio: string | null;
  photoUrl: string | null;
}): {
  name: string;
  title: string | null;
  affiliation: string | null;
  bio: string | null;
  photoUrl: string | null;
} {
  return {
    name: speaker.name,
    title: emptyToNull(speaker.title),
    affiliation: emptyToNull(speaker.affiliation),
    bio: emptyToNull(speaker.bio),
    photoUrl: emptyToNull(speaker.photoUrl),
  };
}

/**
 * Event block for GET /portal/:token. Keeps the fields the portal already
 * returned and adds the home-page ones. No event id.
 */
export function shapePortalEvent(event: {
  name: string;
  dates: string;
  timezone: string;
  displayLogoUrl: string | null;
  brandColor: string | null;
  startDate: string;
  endDate: string;
  venueName: string | null;
  slug: string;
}): {
  name: string;
  dates: string;
  timezone: string;
  displayLogoUrl: string | null;
  brandColor: string | null;
  startDate: string;
  endDate: string;
  venueName: string | null;
  slug: string;
} {
  return {
    name: event.name,
    dates: event.dates,
    timezone: event.timezone,
    displayLogoUrl: event.displayLogoUrl,
    brandColor: event.brandColor,
    startDate: event.startDate,
    endDate: event.endDate,
    venueName: emptyToNull(event.venueName),
    slug: event.slug,
  };
}

/**
 * Session detail added to GET /portal/:token/sessions.
 * Authors are name + isPresenter only, in the order given (authored order).
 */
export function shapePortalSessionDetail(input: {
  description: string | null;
  trackName: string | null;
  trackColor: string | null;
  format: string | null;
  zoomLink: string | null;
  items: Array<{
    title: string;
    abstract: string | null;
    authors: Array<{ name: string; isPresenter?: boolean }>;
  }>;
}): {
  description: string | null;
  trackName: string | null;
  trackColor: string | null;
  format: string | null;
  zoomLink: string | null;
  items: PresenterRosterPaper[];
} {
  return {
    description: input.description,
    trackName: emptyToNull(input.trackName),
    trackColor: emptyToNull(input.trackColor),
    format: emptyToNull(input.format),
    zoomLink: emptyToNull(input.zoomLink),
    items: input.items.map((item) => ({
      title: item.title,
      abstract: item.abstract,
      authors: item.authors.map((author) => ({
        name: author.name,
        isPresenter: Boolean(author.isPresenter),
      })),
    })),
  };
}

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
