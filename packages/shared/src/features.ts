/**
 * Per-event feature registry (Phase 2.6) — shared by API + web.
 */

import { ASSISTANT_COPY } from "./assistants";

export type FeatureCategory =
  | "community"
  | "messaging"
  | "sessions"
  | "engagement"
  | "schedule"
  | "directory"
  | "planned";

export type FeatureKey =
  | "community"
  | "community_meetups"
  | "community_moments"
  | "community_local"
  | "community_icebreakers"
  | "community_general"
  | "messaging_dms"
  | "messaging_requests"
  | "messaging_groups"
  | "messaging_event_chat"
  | "session_qa"
  | "session_likes"
  | "engagement_points"
  | "public_leaderboard"
  | "timezone_toggle"
  | "breakout_style"
  | "attendee_directory"
  | "matchmaker"
  | "concierge"
  | "venue_maps"
  | "waitlist_visibility"
  | "daily_digest"
  | "cfp"
  | "session_polls"
  | "session_feedback"
  | "sponsors"
  | "sponsor_outreach"
  | "checkin"
  | "ops_agent"
  | "recap_agent"
  | "certificates"
  | "paid_attendance"
  | "readiness";

export type FeatureOverrideValue = boolean | "daily" | "weekly" | "interrupts_only";

export type FeatureDefinition = {
  key: FeatureKey;
  name: string;
  plainDescription: string;
  /**
   * Where this actually shows up, verified against the render site
   * (e.g. "Attendee app › Community", "Organizer console › Readiness tab").
   */
  appearsIn?: string;
  category: FeatureCategory;
  defaultOn: boolean;
  dependsOn?: FeatureKey[];
  plannedPhase?: string;
  defaultValue?: FeatureOverrideValue;
  /** No attendee surface any more — hidden from the organizer Features tab. */
  retired?: boolean;
};

export const FEATURE_REGISTRY: FeatureDefinition[] = [
  {
    key: "community",
    name: "Community",
    plainDescription: "The whole Community section where people post and reply.",
    appearsIn: "Attendee app › Community",
    category: "community",
    defaultOn: true,
  },
  {
    key: "community_meetups",
    name: "Meet-ups",
    plainDescription: "Let people propose in-person or virtual meet-ups.",
    appearsIn: "Attendee app › Community",
    category: "community",
    defaultOn: true,
    dependsOn: ["community"],
  },
  {
    key: "community_moments",
    name: "Share your moments",
    plainDescription: "Photo sharing space for event moments.",
    appearsIn: "Attendee app › Community",
    category: "community",
    defaultOn: true,
    dependsOn: ["community"],
  },
  {
    key: "community_local",
    name: "Local recommendations",
    plainDescription: "Tips for places to eat, walk, and explore nearby.",
    appearsIn: "Attendee app › Community",
    category: "community",
    defaultOn: true,
    dependsOn: ["community"],
  },
  {
    key: "community_icebreakers",
    name: "Ice-breakers",
    plainDescription: "A friendly space for intros and conversation starters.",
    appearsIn: "Attendee app › Community",
    category: "community",
    defaultOn: true,
    dependsOn: ["community"],
  },
  {
    key: "community_general",
    name: "General board",
    plainDescription: "Open community posts that don’t fit a special channel.",
    appearsIn: "Attendee app › Community",
    category: "community",
    defaultOn: true,
    dependsOn: ["community"],
  },
  {
    key: "messaging_dms",
    name: "Direct messages",
    plainDescription: "One-to-one private chats between attendees.",
    appearsIn: "Attendee app › Messages",
    category: "messaging",
    defaultOn: true,
  },
  {
    key: "messaging_requests",
    name: "Message requests",
    plainDescription: "First messages from someone new arrive quietly as a request; replying accepts.",
    appearsIn: "Attendee app › Messages",
    category: "messaging",
    defaultOn: true,
  },
  {
    key: "messaging_groups",
    name: "Group chats",
    plainDescription: "Small group conversations attendees create together.",
    appearsIn: "Attendee app › Messages",
    category: "messaging",
    defaultOn: true,
  },
  {
    // Retired by E18 (2026-08-03): event-wide chat duplicated Community
    // (event-wide posting) and Announcements (organizer broadcast). Messages
    // now owns 1:1/group correspondence only. Existing rows are kept; the web
    // app no longer renders EVENT conversations and this toggle is hidden.
    key: "messaging_event_chat",
    name: "Event chat",
    plainDescription: "The shared chat room for everyone at the event.",
    appearsIn: "Retired — no attendee surface",
    category: "messaging",
    defaultOn: true,
    retired: true,
  },
  {
    key: "session_qa",
    name: "Session Q&A",
    plainDescription: "Threaded questions and answers on each session page.",
    appearsIn: "Attendee app › Session page",
    category: "sessions",
    defaultOn: true,
  },
  {
    key: "session_likes",
    name: "Likes on sessions",
    plainDescription: "Let attendees like sessions they are interested in.",
    appearsIn: "Attendee app › Agenda",
    category: "sessions",
    defaultOn: true,
  },
  {
    key: "engagement_points",
    name: "Engagement points",
    plainDescription: "Quiet points for participation (shown on profiles, not as a public contest).",
    appearsIn: "Attendee app › top bar",
    category: "engagement",
    defaultOn: true,
  },
  {
    // No leaderboard surface is built yet — plannedPhase hides the toggle
    // from the organizer Features tab until enforcement exists.
    key: "public_leaderboard",
    name: "Public leaderboard",
    plainDescription: "Show a ranked list of attendees by engagement points.",
    appearsIn: "Planned — not shown yet",
    category: "engagement",
    defaultOn: false,
    dependsOn: ["engagement_points"],
    plannedPhase: "later",
  },
  {
    key: "timezone_toggle",
    name: "Timezone toggle",
    plainDescription: "Let attendees switch between their local time and the event timezone.",
    appearsIn: "Attendee app › Agenda",
    category: "schedule",
    defaultOn: true,
  },
  {
    // H5 (DESIGN_PHASE_H D5 + D7): organizer-declared breakout shape. Only the
    // PD-day preset suggests it — absent elsewhere = defaultOn false. AI
    // suggestion via ingest assumptions is a later chunk.
    key: "breakout_style",
    name: "Pick-one breakouts",
    plainDescription:
      "Attendees choose one session per timeslot — the agenda becomes a slot-by-slot chooser instead of a card wall. For PD days and breakout-style programs.",
    appearsIn: "Attendee app › Agenda",
    category: "schedule",
    defaultOn: false,
  },
  {
    key: "attendee_directory",
    name: "Attendee directory",
    plainDescription: "A searchable list of people at the event.",
    appearsIn: "Attendee app › Attendees",
    category: "directory",
    defaultOn: true,
  },
  {
    key: "matchmaker",
    name: "Matchmaker",
    plainDescription: "Suggest people to meet based on shared interests.",
    appearsIn: "Attendee app › Meet",
    category: "directory",
    defaultOn: false,
    dependsOn: ["attendee_directory"],
  },
  {
    key: "concierge",
    name: ASSISTANT_COPY.attendee.name,
    plainDescription:
      "An in-event wayfinder for attendees that answers only from this event's published schedule, rooms, maps, and FAQ.",
    appearsIn: "Attendee app › Event assistant",
    category: "sessions",
    defaultOn: true,
  },
  {
    key: "venue_maps",
    name: "Venue maps",
    plainDescription: "Interactive floor plans with room pins.",
    appearsIn: "Attendee app › Maps",
    category: "schedule",
    defaultOn: true,
  },
  {
    key: "waitlist_visibility",
    name: "Waitlist visibility",
    plainDescription: "Show waitlist position when a session is full.",
    appearsIn: "Attendee app › Agenda",
    category: "sessions",
    defaultOn: true,
  },
  {
    key: "daily_digest",
    name: "Daily digest",
    plainDescription: "How often quieter updates are bundled for attendees.",
    appearsIn: "Email (not a tab in the app)",
    category: "engagement",
    defaultOn: true,
    defaultValue: "daily",
  },
  {
    key: "cfp",
    name: "Call for proposals",
    plainDescription: "Public submission of papers, presentations and workshops, with program-committee review.",
    appearsIn: "Organizer console › CFP · Public CFP page",
    category: "sessions",
    defaultOn: false,
  },
  {
    key: "session_polls",
    name: "Live polls",
    plainDescription: "Multiple-choice polls attached to sessions that organizers can open and close live.",
    appearsIn: "Attendee app › Session page",
    category: "sessions",
    defaultOn: true,
  },
  {
    key: "session_feedback",
    name: "Session feedback",
    plainDescription: "After a session ends, attendees can leave a 1–5 rating and optional comment.",
    appearsIn: "Attendee app › Session page",
    category: "sessions",
    defaultOn: true,
  },
  {
    key: "sponsors",
    name: "Sponsors",
    plainDescription: "Sponsor logos by tier on attendee pages, with optional exhibitor lead capture.",
    appearsIn: "Attendee app › Agenda · Organizer console › Sponsors",
    category: "engagement",
    defaultOn: true,
  },
  {
    // SPX-0 / SPX-1 (DESIGN_PHASE_K D1): pipeline + composer. Readyhall never
    // sends outreach email. Entitled on every tier (Free included, capped
    // at outreachProspectsPerEvent 25); still depends on Sponsors being on.
    key: "sponsor_outreach",
    name: "Sponsor outreach",
    plainDescription:
      "A private list of organizations you want to ask. Sponsors hear from you, not from us — you send from your own address.",
    appearsIn: "Organizer console › Sponsors",
    category: "engagement",
    defaultOn: true,
    dependsOn: ["sponsors"],
  },
  {
    key: "checkin",
    name: "QR check-in",
    plainDescription: "Per-attendee QR codes and a staff scanner (works offline with auto-sync).",
    appearsIn: "Organizer console › Check-in · Attendee app › Profile",
    category: "engagement",
    defaultOn: true,
  },
  {
    key: "ops_agent",
    name: "Ops Inbox",
    plainDescription: "Event-day detectors that draft announcements and nudges for organizer review before send.",
    appearsIn: "Organizer console › Ops Inbox",
    category: "engagement",
    defaultOn: true,
  },
  {
    key: "recap_agent",
    name: "Post-event recap",
    plainDescription: "One-click report, feedback synthesis, certificate drafts, and thank-you emails after the event ends.",
    appearsIn: "Organizer console › Recap",
    category: "engagement",
    defaultOn: true,
  },
  {
    key: "certificates",
    name: "Certificates",
    plainDescription: "Post-event certificate download for eligible attendees (organizer templates + batch issue).",
    appearsIn: "Attendee download after the event · Organizer console › Recap · Public verify page",
    category: "engagement",
    defaultOn: true,
  },
  {
    // PAY-T0 (DESIGN_PHASE_J §Paid attendance). No plannedPhase: this is a
    // normal organizer toggle. There is no payment processing behind it — the
    // platform is never the merchant of record for attendee money — so off
    // means the fee notice and the roster's Payment column simply do not exist.
    key: "paid_attendance",
    name: "Registration fees",
    plainDescription:
      "Track registration fees — show attendees how to pay (card link, PO, or check) and track who has paid. Payments happen on your own link or process; we never process, hold, or handle the money.",
    appearsIn: "Public event page · Organizer console › Participants",
    category: "engagement",
    defaultOn: false,
  },
  {
    // Event Readiness — generally available (ER-GA, founder decision
    // 2026-08-26). A normal organizer toggle on every plan: no plannedPhase,
    // still off until the organizer turns it on. Free is capped at
    // `readinessPresentersPerEvent` presenters (plans.ts).
    key: "readiness",
    name: "Speaker & Session Readiness",
    plainDescription:
      "Track what every accepted speaker, paper, presentation and session still needs before it is show-ready.",
    appearsIn: "Organizer console › Readiness tab",
    category: "sessions",
    defaultOn: false,
  },
];

export const FEATURE_BY_KEY: Record<FeatureKey, FeatureDefinition> = Object.fromEntries(
  FEATURE_REGISTRY.map((f) => [f.key, f]),
) as Record<FeatureKey, FeatureDefinition>;

export type FeaturePresetId = "everything" | "focused" | "academic" | "pd_day" | "talk_showcase";

export type FeaturePreset = {
  id: FeaturePresetId;
  name: string;
  plainDescription: string;
  overrides: Partial<Record<FeatureKey, FeatureOverrideValue>>;
};

export const FEATURE_PRESETS: FeaturePreset[] = [
  {
    id: "everything",
    name: "Everything on",
    plainDescription: "Turn on all available attendee features.",
    overrides: {
      community: true,
      community_meetups: true,
      community_moments: true,
      community_local: true,
      community_icebreakers: true,
      community_general: true,
      messaging_dms: true,
      messaging_requests: true,
      messaging_groups: true,
      session_qa: true,
      session_likes: true,
      engagement_points: true,
      public_leaderboard: false,
      timezone_toggle: true,
      attendee_directory: true,
      waitlist_visibility: true,
      venue_maps: true,
      daily_digest: true,
      concierge: true,
      session_polls: true,
      session_feedback: true,
      sponsors: true,
      sponsor_outreach: true,
      checkin: true,
      ops_agent: true,
      recap_agent: true,
      certificates: true,
    },
  },
  {
    id: "focused",
    name: "Focused",
    plainDescription: "Agenda, session Q&A, and announcements only — quieter networking.",
    overrides: {
      community: false,
      community_meetups: false,
      community_moments: false,
      community_local: false,
      community_icebreakers: false,
      community_general: false,
      messaging_dms: false,
      messaging_requests: false,
      messaging_groups: false,
      session_qa: true,
      session_likes: false,
      engagement_points: false,
      public_leaderboard: false,
      timezone_toggle: true,
      attendee_directory: false,
      matchmaker: false,
      waitlist_visibility: true,
      venue_maps: false,
      daily_digest: "interrupts_only",
      cfp: false,
      concierge: false,
      session_polls: false,
      session_feedback: true,
      sponsors: false,
      sponsor_outreach: false,
      checkin: true,
      ops_agent: false,
      recap_agent: false,
      certificates: false,
    },
  },
  {
    id: "academic",
    name: "Academic program",
    plainDescription: "Community on, photo moments off, no public leaderboard.",
    overrides: {
      community: true,
      community_meetups: true,
      community_moments: false,
      community_local: true,
      community_icebreakers: true,
      community_general: true,
      messaging_dms: true,
      messaging_requests: true,
      messaging_groups: true,
      session_qa: true,
      session_likes: true,
      engagement_points: true,
      public_leaderboard: false,
      timezone_toggle: true,
      attendee_directory: true,
      matchmaker: true,
      waitlist_visibility: true,
      venue_maps: true,
      daily_digest: true,
      cfp: true,
      session_polls: true,
      session_feedback: true,
      sponsors: true,
      sponsor_outreach: true,
      checkin: true,
      ops_agent: true,
      recap_agent: true,
      certificates: true,
    },
  },
  {
    id: "pd_day",
    name: "PD day / Training",
    plainDescription:
      "Calm defaults for a staff PD day — pick-one breakouts, certificates on, photo sharing off.",
    overrides: {
      community: true,
      community_meetups: false,
      community_moments: false,
      community_local: false,
      community_icebreakers: true,
      community_general: true,
      messaging_dms: true,
      messaging_requests: true,
      messaging_groups: true,
      session_qa: true,
      session_likes: true,
      engagement_points: false,
      public_leaderboard: false,
      // Everyone is in the same building on the same day.
      timezone_toggle: false,
      breakout_style: true,
      attendee_directory: true,
      matchmaker: false,
      waitlist_visibility: true,
      venue_maps: true,
      daily_digest: "interrupts_only",
      cfp: false,
      concierge: true,
      session_polls: true,
      session_feedback: true,
      sponsors: false,
      sponsor_outreach: false,
      checkin: true,
      ops_agent: true,
      recap_agent: true,
      certificates: true,
    },
  },
  {
    id: "talk_showcase",
    name: "Talk showcase",
    plainDescription:
      "Single-stage short-talk events — curated talk showcases, storytelling nights, lightning-talk days.",
    overrides: {
      community: true,
      community_meetups: false,
      community_moments: true,
      community_local: true,
      community_icebreakers: true,
      community_general: true,
      messaging_dms: true,
      messaging_requests: true,
      messaging_groups: true,
      session_qa: false,
      session_likes: true,
      engagement_points: false,
      public_leaderboard: false,
      timezone_toggle: false,
      breakout_style: false,
      attendee_directory: true,
      matchmaker: false,
      waitlist_visibility: true,
      venue_maps: true,
      daily_digest: "interrupts_only",
      cfp: false,
      concierge: true,
      session_polls: false,
      session_feedback: true,
      sponsors: true,
      sponsor_outreach: true,
      checkin: true,
      ops_agent: true,
      recap_agent: true,
      certificates: true,
      paid_attendance: true,
    },
  },
];

export function getOrganizerVisibleFeatures(): FeatureDefinition[] {
  return FEATURE_REGISTRY.filter((f) => !f.plannedPhase && !f.retired);
}

export function dependencyBlockReason(key: FeatureKey, effectiveOffParents: FeatureKey[]): string | null {
  if (!effectiveOffParents.length) return null;
  const def = FEATURE_BY_KEY[key];
  if (key === "matchmaker" && effectiveOffParents.includes("attendee_directory")) {
    return "Matchmaker needs the attendee directory";
  }
  if (key === "sponsor_outreach" && effectiveOffParents.includes("sponsors")) {
    return "Sponsor outreach needs Sponsors to be on";
  }
  if (effectiveOffParents.includes("community") && def.dependsOn?.includes("community")) {
    return "This channel needs Community to be on";
  }
  if (effectiveOffParents.includes("engagement_points") && key === "public_leaderboard") {
    return "Public leaderboard needs engagement points";
  }
  return `Requires ${effectiveOffParents.map((k) => FEATURE_BY_KEY[k].name).join(", ")}`;
}

export function featureKeyForNetworkChannel(channel: string): FeatureKey | null {
  switch (channel) {
    case "MEETUP":
      return "community_meetups";
    case "MOMENTS":
      return "community_moments";
    case "LOCAL":
      return "community_local";
    case "ICEBREAKER":
      return "community_icebreakers";
    case "GENERAL":
      return "community_general";
    default:
      return null;
  }
}

/** Pure resolve for UI + tests (no DB). */
export function resolveFeatureEnabled(
  key: FeatureKey,
  overrides: Partial<Record<FeatureKey, FeatureOverrideValue>>,
  opts?: { planAllows?: boolean },
): boolean {
  const def = FEATURE_BY_KEY[key];
  if (!def) return false;
  if (opts?.planAllows === false) return false;

  for (const parent of def.dependsOn || []) {
    if (!resolveFeatureEnabled(parent, overrides, opts)) return false;
  }

  const override = overrides[key];
  if (typeof override === "boolean") return override;
  if (key === "daily_digest") {
    if (override === "daily" || override === "weekly" || override === "interrupts_only") return true;
    return def.defaultOn;
  }
  return def.defaultOn;
}

export function applyPreset(presetId: FeaturePresetId): Partial<Record<FeatureKey, FeatureOverrideValue>> {
  const preset = FEATURE_PRESETS.find((p) => p.id === presetId);
  if (!preset) return {};
  return { ...preset.overrides };
}

export function normalizeOverridesForSave(
  input: Partial<Record<FeatureKey, FeatureOverrideValue>>,
): {
  overrides: Partial<Record<FeatureKey, FeatureOverrideValue>>;
  forcedOff: { key: FeatureKey; reason: string }[];
} {
  const overrides = { ...input };
  const forcedOff: { key: FeatureKey; reason: string }[] = [];

  if (overrides.community === false) {
    for (const child of FEATURE_REGISTRY.filter((f) => f.dependsOn?.includes("community"))) {
      overrides[child.key] = false;
    }
  }

  if (overrides.attendee_directory === false && overrides.matchmaker !== false) {
    overrides.matchmaker = false;
    forcedOff.push({
      key: "matchmaker",
      reason: dependencyBlockReason("matchmaker", ["attendee_directory"]) || "Matchmaker needs the attendee directory",
    });
  }

  if (overrides.engagement_points === false && overrides.public_leaderboard !== false) {
    overrides.public_leaderboard = false;
    forcedOff.push({
      key: "public_leaderboard",
      reason:
        dependencyBlockReason("public_leaderboard", ["engagement_points"]) || "Requires engagement points",
    });
  }

  if (overrides.sponsors === false && overrides.sponsor_outreach !== false) {
    overrides.sponsor_outreach = false;
    forcedOff.push({
      key: "sponsor_outreach",
      reason:
        dependencyBlockReason("sponsor_outreach", ["sponsors"]) || "Sponsor outreach needs Sponsors to be on",
    });
  }

  return { overrides, forcedOff };
}
