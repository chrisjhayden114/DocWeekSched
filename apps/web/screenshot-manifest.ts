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

/** Every capture ends up this wide so the hover cards crop uniformly. */
export const SCREENSHOT_WIDTH = 1200;
/** Short panels get padded out; tall ones get cut rather than filed as posters. */
export const SCREENSHOT_MIN_HEIGHT = 380;
export const SCREENSHOT_MAX_HEIGHT = 760;

/**
 * A frame this tall is the only shape a hover card shows whole: the card crops
 * its art slot to 400x170 with `object-fit: cover` + `object-position: left top`,
 * and 1200x510 is the same 40:17. A taller frame loses a band off the bottom
 * to that crop, which is why a shot whose whole point is its page heading asks
 * for this height instead of the 760 a long page would otherwise fill.
 */
export const SCREENSHOT_CARD_HEIGHT = 510;

/**
 * How much of the manifest a capture run has to land before the run counts as
 * a failure. One surface breaking is not worth throwing away the other thirty:
 * below this the run fails, at or above it the good images still get committed
 * and the failed keys keep whatever image they already had.
 */
export const SCREENSHOT_MIN_PASS_RATIO = 0.9;

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
  /** Not used in a path any more — the maps shot photographs the plan unfocused. */
  "pinId",
  /** Not used in a path any more — the certificate shot photographs the PDF. */
  "certificateId",
  "directConversationId",
  "groupConversationId",
] as const;

export type ScreenshotToken = (typeof KNOWN_TOKENS)[number];

type ShotBase = {
  /** Which seeded account's view this belongs to. */
  as: "attendee" | "organizer";
  /**
   * Attendee surfaces read `localStorage.activeEventId`, so a shot has to say
   * which seeded event it belongs to. Defaults to the main summit.
   */
  event?: "main" | "breakouts";
  /** Why this surface is the honest picture of the feature. */
  note: string;
};

/** The usual kind: photograph part of a running page. */
export type PageFeatureShot = ShotBase & {
  source?: "page";
  /** Web path, `{token}` placeholders allowed. */
  path: string;
  /**
   * The element to photograph — not the whole page. Component selectors are
   * captured as element screenshots, exactly bounded; the page-scope selectors
   * in screenshot-frame.ts stay document clips, because for those the element
   * is the content column and the page around it is the picture.
   */
  selector: string;
  viewport?: { width: number; height: number };
  /** Clicked in order before the shot (channel pills, the assistant launcher). */
  clicks?: string[];
  /** Extra selector to await when `selector` can render before its content. */
  waitFor?: string;
  /**
   * An `<img>` inside the subject that must have decoded (naturalWidth > 0)
   * before the shutter opens. A visible `<img>` whose bytes were rejected is
   * still a visible element, which is how a floor plan photographed as a pin
   * on white.
   */
  waitForImage?: string;
  /** Playwright fills run after clicks/waitFor, before the shot. */
  fills?: Array<{ selector: string; value: string }>;
  /**
   * Clip the subject to this many CSS pixels. On an element shot it is the
   * subject's own top N pixels; on a page-scope or align-top shot it is the
   * height of the whole clip, so SCREENSHOT_CARD_HEIGHT frames a page heading.
   */
  clipHeight?: number;
  /**
   * Extra CSS for this shot only — collapse empty flex regions so chips and
   * an input can share a tight frame without inventing conversation content.
   */
  stageCss?: string;
  /**
   * Render the subject at N times its layout size before the shutter opens
   * (see `magnifyCss`). For a control too small for the fill rule to reach on
   * pixels alone: a 60px pill can only become a legible subject if it is
   * re-rendered at size rather than resampled.
   */
  magnify?: number;
  /**
   * Scroll the subject to its top edge before measuring, and include a pad
   * above the first heading/card. Console tabs need this so the crop does
   * not open mid-row.
   */
  alignTop?: boolean;
  /**
   * CSS selector inside the shot. Before capture, that element gets a 3px
   * amber outline and a white halo so the feature reads on a busy surface.
   * Must be real CSS — Playwright `:text-is()` is not valid in a stylesheet.
   */
  highlight?: string;
  /**
   * Hug the subject: skip the 380px frame floor so a short card is not
   * padded with dead white.
   */
  hug?: boolean;
};

/**
 * A file the seed produced rather than a surface the browser can visit. The
 * certificate is the only one: the feature's artefact is a branded PDF, and a
 * screenshot of a web page describing it is not a picture of the certificate.
 */
export type PdfFeatureShot = ShotBase & {
  source: "pdf";
  /** Which page of the PDF to photograph. */
  page: number;
  /** Resolution pdftoppm renders at before the frame step normalises it. */
  dpi: number;
};

export type FeatureShot = PageFeatureShot | PdfFeatureShot;

export function isPdfShot(shot: FeatureShot): shot is PdfFeatureShot {
  return shot.source === "pdf";
}

export function isPageShot(shot: FeatureShot): shot is PageFeatureShot {
  return !isPdfShot(shot);
}

const COMMUNITY_PILLS = '.kit-filter-pills[aria-label="Community channels"] button.kit-pill';

/** Organizer console tabs all render into one wrapper keyed by `?tab=`. */
const CONSOLE_TAB = ".motion-fade";

/**
 * MANUAL-1 — these eight keys have a founder-approved image in
 * `public/feature-guide/<key>.png`. `FEATURE_GUIDE.imageSrc` wins over
 * `/feature-guide/auto/<key>.png`, so recapturing or "fixing" the auto shot
 * will not change what hover cards or /help/feature-guide show:
 * concierge, cfp, readiness, engagement_points, certificates, venue_maps,
 * session_feedback, sponsor_outreach.
 */
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
    highlight: "button.session-like-btn",
    note: "Likes live on agenda rows, so the card wall is the surface — not a session page.",
  },
  session_polls: {
    path: "/session/{liveSessionId}",
    selector: '.card:has(> h3:text-is("Live polls"))',
    as: "attendee",
    note: "An OPEN poll with results showing, which needs votes spread across options.",
  },
  // MANUAL-1: founder-approved image overrides this auto shot — it will not show.
  session_feedback: {
    path: "/session/{endedSessionId}",
    selector: ".session-feedback-card",
    as: "attendee",
    hug: true,
    note: "The card only exists after a session's end time — this one finished yesterday.",
  },
  waitlist_visibility: {
    path: "/session/{fullSessionId}",
    selector: ".card.session-page-header",
    as: "attendee",
    highlight: ".session-waitlist-chip",
    note: "The capped session: two seats taken, three people waiting with real positions.",
  },
  // MANUAL-1: founder-approved image overrides this auto shot — it will not show.
  concierge: {
    path: "/dashboard?tab=Agenda",
    selector: ".concierge-panel",
    as: "attendee",
    clicks: ["button.concierge-fab"],
    waitFor: ".concierge-chip",
    clipHeight: 420,
    stageCss:
      ".concierge-panel .concierge-messages { flex: 0 0 auto; min-height: 0; max-height: 40px; overflow: hidden; }",
    note:
      "Honest empty state: header, the three starter chips, and the input. The messages column is collapsed for the frame so chips and input sit together — no fake conversation.",
  },
  // MANUAL-1: founder-approved image overrides this auto shot — it will not show.
  cfp: {
    path: "/e/{slug}/cfp",
    selector: "main.page",
    as: "attendee",
    waitFor: "form.console-form",
    alignTop: true,
    // The h1 was in the PNG and still missing from the card: a 760-tall frame
    // is centre-cropped to its middle band, which threw the title away and left
    // a floating text box. A card-shaped clip is shown whole.
    clipHeight: SCREENSHOT_CARD_HEIGHT,
    fills: [
      { selector: 'form.console-form label:has-text("Your name") input', value: "Priya Raghunathan" },
      {
        selector: 'form.console-form label:has-text("Email") input',
        value: "priya.raghunathan@ashgrove-schools.example",
      },
      {
        selector: 'form.console-form label:has-text("Title") input',
        value: "Workshop: Reporting families can actually read",
      },
      {
        selector: 'form.console-form label:has-text("Abstract") textarea',
        value:
          "A live rewrite of a report template with parents' questions on the wall. Participants leave with a one-page version they can try in their next cycle.",
      },
    ],
    note:
      "The public submission form under its own page heading, with a filled-in Northbridge draft. Clipped to the card's own shape so the title is in the picture wherever the picture is shown.",
  },
  // MANUAL-1: founder-approved image overrides this auto shot — it will not show.
  readiness: {
    path: "/organizer/events/{eventId}?tab=readiness",
    selector: CONSOLE_TAB,
    as: "organizer",
    alignTop: true,
    waitFor: ".console-panel-label",
    note: "The board with assignments in every state the tracker can render. Framed from the first heading.",
  },

  // MANUAL-1: founder-approved image overrides this auto shot — it will not show.
  engagement_points: {
    path: "/dashboard?tab=Agenda",
    selector: ".points-gem",
    as: "attendee",
    waitFor: ".points-gem",
    // 60-odd pixels of pill cannot be filled out of a 1x capture at any
    // sharpness, so it is re-rendered at size first. The rest clears the top bar
    // around it: the pill is centred in the row and the row is deep enough that
    // the magnified subject sits on the bar's own white instead of straddling
    // the page underneath.
    // 8x, not 4x or 6x: the pill is ~62 CSS px wide, and only at 8x does the
    // frame step's sharpness cap still leave it filling the width.
    magnify: 8,
    stageCss: [
      ".shell-topbar { min-height: 340px !important; }",
      ".shell-topbar-identity { display: none !important; }",
      ".shell-topbar-actions { margin: 0 auto !important; }",
      ".shell-avatar-menu { display: none !important; }",
    ].join("\n"),
    note:
      "The gem and count themselves, which is all the flag controls, rendered at a size where the tier gem and the running total are both legible. Nothing about the pill's own styling changes — it is the real chrome, photographed close up.",
  },
  timezone_toggle: {
    path: "/dashboard?tab=Agenda",
    selector: ".agenda-context-bar",
    as: "attendee",
    highlight: ".agenda-timezone-toggle--desktop",
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
  // MANUAL-1: founder-approved image overrides this auto shot — it will not show.
  venue_maps: {
    // No `pinId`: deep-linking a pin zooms the canvas to 2.2x and centres it on
    // that pin, which photographed as a marker on the empty inside of one room.
    // Unfocused, the plan sits at 1:1 with every pin on it.
    path: "/dashboard?tab=Maps&mapId={mapId}",
    selector: ".floor-plan-viewport",
    as: "attendee",
    waitFor: "img.floor-plan-image",
    waitForImage: "img.floor-plan-image",
    note:
      "The plan itself, at the scale it loads at: the labelled Civic Centre rooms with the three room-linked pins standing on Northbridge Hall, Workshop A, and the Reading Room. No pin sheet over the drawing.",
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
    waitForImage: "img",
    note:
      "The attendee-facing strip, grouped by tier — four seeded sponsors with real logo artwork, which is what turning the flag off hides.",
  },
  // MANUAL-1: founder-approved image overrides this auto shot — it will not show.
  sponsor_outreach: {
    path: "/organizer/events/{eventId}/sponsors",
    selector: "section.outreach-section",
    as: "organizer",
    note: "Organizer-only pipeline with rows in every status. Attendees never see this.",
  },
  checkin: {
    path: "/dashboard?tab=Profile",
    selector: 'div:has(> strong:text-is("Event check-in QR"))',
    as: "attendee",
    waitFor: 'img[alt="Your check-in QR code"]',
    note:
      "The attendee's own code, which is the half of check-in that has a picture. The staff scanner console exists, but under Chromium's fake camera device its stage photographs as a synthetic green test pattern rather than as a check-in.",
  },
  ops_agent: {
    path: "/organizer/events/{eventId}?tab=ops",
    selector: CONSOLE_TAB,
    as: "organizer",
    alignTop: true,
    waitFor: ".console-panel-label",
    note: "Organizer-only inbox of drafted cards that send nothing until applied. Framed from the first heading.",
  },
  recap_agent: {
    path: "/organizer/events/{eventId}?tab=recap",
    selector: CONSOLE_TAB,
    as: "organizer",
    alignTop: true,
    waitFor: 'button:has-text("REPORT")',
    note:
      "Seeded recap workspace (REPORT, FEEDBACK SYNTHESIS, CERTIFICATES). Generate stays locked because the event is still running.",
  },
  // MANUAL-1: founder-approved image overrides this auto shot — it will not show.
  certificates: {
    source: "pdf",
    page: 1,
    dpi: 150,
    as: "attendee",
    note:
      "The certificate itself — page one of the issued PDF the seed rendered through the product's own renderer, carrying the event's accent. The public verify card used to stand in for this, but a page that says a certificate is valid is not a picture of the certificate.",
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

/**
 * Whether a capture run is worth committing. Attempting nothing passes: an
 * empty `--only` selection is a no-op, not a broken set.
 */
export function captureRunPassed(captured: number, attempted: number): boolean {
  if (attempted <= 0) return true;
  return captured / attempted >= SCREENSHOT_MIN_PASS_RATIO;
}

/** `{token}` names used by a path, in order of appearance. */
export function tokensInPath(path: string): string[] {
  return [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
}

export function shotFor(key: FeatureKey): FeatureShot | undefined {
  return SCREENSHOT_MANIFEST[key];
}
