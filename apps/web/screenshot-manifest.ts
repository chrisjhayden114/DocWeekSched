/**
 * SHOT-CI — which surface photographs each Feature Guide hover card.
 *
 * One entry per eligible FeatureKey: everything in FEATURE_REGISTRY that is not
 * `retired` (no surface left) and has no `plannedPhase` (nothing built yet).
 * `__tests__/screenshotManifest.test.ts` fails if the registry gains a key that
 * nobody photographed, so this file cannot quietly fall behind the product.
 *
 * `scripts/capture-screenshots.ts` consumes it against the seeded Northbridge
 * events from `apps/api/src/lib/screenshotSeed`. Paths interpolate `{token}`
 * placeholders from that seed's output — see KNOWN_TOKENS.
 */

import { FEATURE_REGISTRY, type FeatureKey } from "@event-app/shared";

/** Wide enough that the desktop shell renders and a 1200px clip still fits. */
export const SCREENSHOT_VIEWPORT = { width: 1440, height: 1100 } as const;

/** Every capture is clipped to this width so the hover cards crop uniformly. */
export const SCREENSHOT_WIDTH = 1200;
/** Short panels get padded out; tall ones get cut rather than filed as posters. */
export const SCREENSHOT_MIN_HEIGHT = 380;
export const SCREENSHOT_MAX_HEIGHT = 760;

/** Written by the capture script; `public/` makes them `/feature-guide/auto/...`. */
export const AUTO_SHOT_DIR = "public/feature-guide/auto";
export const AUTO_SHOT_URL_PREFIX = "/feature-guide/auto";

/**
 * Placeholders a manifest path may use. The capture script throws on anything
 * else, which is what catches a seed and a manifest drifting apart.
 */
export const KNOWN_TOKENS = [
  "eventId",
  "slug",
  /** Not used in a path — read directly for shots marked `event: "breakouts"`. */
  "breakoutEventId",
  "liveSessionId",
  "endedSessionId",
  "fullSessionId",
  "mapId",
  "pinId",
  "certificateId",
  "directConversationId",
  "groupConversationId",
] as const;

export type ScreenshotToken = (typeof KNOWN_TOKENS)[number];

export type FeatureShot = {
  /** Web path, `{token}` placeholders allowed. */
  path: string;
  /** The element to measure and clip around — not the whole page. */
  selector: string;
  /** Which seeded account to sign in as before loading `path`. */
  as: "attendee" | "organizer";
  /**
   * Attendee surfaces read `localStorage.activeEventId`, so a shot has to say
   * which seeded event it belongs to. Defaults to the main summit.
   */
  event?: "main" | "breakouts";
  viewport?: { width: number; height: number };
  /** Clicked in order before the shot (channel pills, the assistant launcher). */
  clicks?: string[];
  /** Extra selector to await when `selector` can render before its content. */
  waitFor?: string;
  /** Why this surface is the honest picture of the feature. */
  note: string;
};

const COMMUNITY_PILLS = '.kit-filter-pills[aria-label="Community channels"] button.kit-pill';

/** Organizer console tabs all render into one wrapper keyed by `?tab=`. */
const CONSOLE_TAB = ".motion-fade";

export const SCREENSHOT_MANIFEST: Record<string, FeatureShot> = {
  community: {
    path: "/dashboard?tab=Community",
    selector: ".kit-page-stack",
    as: "attendee",
    waitFor: ".community-feed",
    note: "The whole board: channel pills, composer, and the mixed feed underneath.",
  },
  community_meetups: {
    path: "/dashboard?tab=Community",
    selector: ".community-feed",
    as: "attendee",
    clicks: [`${COMMUNITY_PILLS}:text-is("Meet-ups")`],
    waitFor: ".kit-feed-card",
    note: "Filtered feed showing invite scope, format, time, and a virtual link.",
  },
  community_moments: {
    path: "/dashboard?tab=Community",
    selector: ".community-feed",
    as: "attendee",
    clicks: [`${COMMUNITY_PILLS}:text-is("Moments")`],
    waitFor: ".moments-grid",
    note: "Photo-first cards — the only channel that renders an image grid.",
  },
  community_local: {
    path: "/dashboard?tab=Community",
    selector: ".community-feed",
    as: "attendee",
    clicks: [`${COMMUNITY_PILLS}:text-is("Local tips")`],
    waitFor: ".kit-feed-card",
    note: "Local tips are the only channel carrying an Open in Google Maps link.",
  },
  community_icebreakers: {
    path: "/dashboard?tab=Community",
    selector: ".kit-page-stack",
    as: "attendee",
    clicks: [`${COMMUNITY_PILLS}:text-is("Break the ice")`],
    waitFor: ".kit-feed-card",
    note: "Kept at page scope so the people-discovery carousel above the feed is in frame.",
  },
  community_general: {
    path: "/dashboard?tab=Community",
    selector: ".community-feed",
    as: "attendee",
    clicks: [`${COMMUNITY_PILLS}:text-is("General")`],
    waitFor: ".kit-feed-card",
    note: "General is the only channel with audience targeting, so a To: pill is visible.",
  },

  messaging_dms: {
    path: "/dashboard?tab=Messages&c={directConversationId}",
    selector: ".messages-layout",
    as: "attendee",
    waitFor: ".conversation-row",
    note: "Inbox plus an open one-to-one thread, which is all Messages owns now.",
  },
  messaging_requests: {
    path: "/dashboard?tab=Messages",
    selector: ".messages-layout",
    as: "attendee",
    waitFor: ".conversation-row",
    note: "The seeded REQUESTED thread puts a Requests section under the main inbox.",
  },
  messaging_groups: {
    path: "/dashboard?tab=Messages&c={groupConversationId}",
    selector: ".messages-layout",
    as: "attendee",
    waitFor: ".conversation-row",
    note: "A named group thread with its member list in the header.",
  },

  session_qa: {
    path: "/session/{liveSessionId}",
    selector: ".session-conversation-card",
    as: "attendee",
    note: "Threaded questions with votes and one thread already marked answered.",
  },
  session_likes: {
    path: "/dashboard?tab=Agenda",
    selector: ".schedule-list",
    as: "attendee",
    waitFor: ".agenda-context-bar",
    note: "Likes live on agenda rows, so the card wall is the surface — not a session page.",
  },
  session_polls: {
    path: "/session/{liveSessionId}",
    selector: '.card:has(> h3:text-is("Live polls"))',
    as: "attendee",
    note: "An OPEN poll with results showing, which needs votes spread across options.",
  },
  session_feedback: {
    path: "/session/{endedSessionId}",
    selector: '.card:has(> h3:text-is("Session feedback"))',
    as: "attendee",
    note: "The card only exists after a session's end time — this one finished yesterday.",
  },
  waitlist_visibility: {
    path: "/session/{fullSessionId}",
    selector: ".card.session-page-header",
    as: "attendee",
    note: "The capped session: two seats taken, three people waiting with real positions.",
  },
  concierge: {
    path: "/dashboard?tab=Agenda",
    selector: ".concierge-panel",
    as: "attendee",
    clicks: ["button.concierge-fab"],
    note: "The assistant is a launcher until opened, so the panel is the only real picture.",
  },
  cfp: {
    path: "/e/{slug}/cfp",
    selector: "main.page",
    as: "attendee",
    waitFor: "form.console-form",
    note: "The public submission form. Standalone page — the signed-in session is irrelevant.",
  },
  readiness: {
    path: "/organizer/events/{eventId}?tab=readiness",
    selector: CONSOLE_TAB,
    as: "organizer",
    note: "The board with assignments in every state the tracker can render.",
  },

  engagement_points: {
    path: "/dashboard?tab=Agenda",
    selector: ".shell-topbar",
    as: "attendee",
    waitFor: ".points-gem",
    note: "The flag only controls the gem and count in the app chrome — that is the whole surface.",
  },
  timezone_toggle: {
    path: "/dashboard?tab=Agenda",
    selector: ".agenda-context-bar",
    as: "attendee",
    note: "The My timezone / Event timezone control sits in the agenda filter rail.",
  },
  breakout_style: {
    path: "/dashboard?tab=Agenda",
    selector: ".schedule-list",
    as: "attendee",
    event: "breakouts",
    waitFor: ".agenda-context-bar",
    note: "Its own event: pick-one breakouts rewrites the agenda the other shots depend on.",
  },
  venue_maps: {
    path: "/dashboard?tab=Maps&mapId={mapId}&pinId={pinId}",
    selector: ".venue-maps-attendee",
    as: "attendee",
    note: "A floor plan with room-linked pins, opened on a pin.",
  },
  attendee_directory: {
    path: "/dashboard?tab=Attendees",
    selector: ".attendee-directory",
    as: "attendee",
    waitFor: ".attendee-rows",
    note: "Only opted-in members are listed, which is the point of the card.",
  },
  matchmaker: {
    path: "/dashboard?tab=Meet",
    selector: ".matchmaker-panel",
    as: "attendee",
    note: "Suggestion cards with why-lines and a Draft intro that never sends by itself.",
  },
  daily_digest: {
    path: "/dashboard?tab=Notifications",
    selector: ".motion-enter > .card",
    as: "attendee",
    note: "There is no digest tab — the rollup is read in Notifications and in email.",
  },
  sponsors: {
    path: "/dashboard?tab=Agenda",
    selector: 'section.card:has(> h3:text-is("Sponsors"))',
    as: "attendee",
    note: "The attendee-facing strip, grouped by tier — what turning the flag off hides.",
  },
  sponsor_outreach: {
    path: "/organizer/events/{eventId}/sponsors",
    selector: "section.outreach-section",
    as: "organizer",
    note: "Organizer-only pipeline with rows in every status. Attendees never see this.",
  },
  checkin: {
    path: "/organizer/events/{eventId}/scanner",
    selector: ".scanner-page",
    as: "organizer",
    waitFor: ".scanner-status-bar",
    note: "The staff scanner console. Chromium's fake camera device keeps the stage from going black.",
  },
  ops_agent: {
    path: "/organizer/events/{eventId}?tab=ops",
    selector: CONSOLE_TAB,
    as: "organizer",
    note: "Organizer-only inbox of drafted cards that send nothing until applied.",
  },
  recap_agent: {
    path: "/organizer/events/{eventId}?tab=recap",
    selector: CONSOLE_TAB,
    as: "organizer",
    note: "The recap workspace. The seeded event is still running, so Generate is honestly locked.",
  },
  certificates: {
    path: "/verify/{certificateId}",
    selector: ".mkt-login-card",
    as: "attendee",
    note: "There is no attendee Certificates tab; the public verify page is the only visual surface.",
  },
  paid_attendance: {
    path: "/organizer/events/{eventId}?tab=participants",
    selector: ".console-table-wrap",
    as: "organizer",
    waitFor: "table.console-table tbody tr",
    note: "The roster's Payment column, seeded across all five statuses plus a never-tracked row.",
  },
};

/**
 * Keys that must appear in SCREENSHOT_MANIFEST: shipped features with a
 * surface. Retired keys have nothing left to photograph and planned keys have
 * nothing built yet.
 */
export function eligibleScreenshotKeys(): FeatureKey[] {
  return FEATURE_REGISTRY.filter((f) => !f.retired && !f.plannedPhase).map((f) => f.key);
}

/** `{token}` names used by a path, in order of appearance. */
export function tokensInPath(path: string): string[] {
  return [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
}

export function shotFor(key: FeatureKey): FeatureShot | undefined {
  return SCREENSHOT_MANIFEST[key];
}
