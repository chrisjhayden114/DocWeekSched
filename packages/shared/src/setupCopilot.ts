/**
 * Phase A2 — Event Setup Copilot shared types.
 * Conversation state is client-held; server is stateless per turn.
 */

import type { ConciergeLink } from "./concierge";
import type { FeatureKey, FeatureOverrideValue, FeaturePresetId } from "./features";

export type SetupEventType =
  | "conference"
  | "academic_program"
  | "meetup"
  | "internal"
  | "pd_day"
  | "talk_showcase";

export const SETUP_EVENT_TYPES: readonly SetupEventType[] = [
  "conference",
  "academic_program",
  "meetup",
  "internal",
  "pd_day",
  "talk_showcase",
];

/** Human-readable names — the raw enum token is never shown to an organizer. */
export const SETUP_EVENT_TYPE_LABEL: Record<SetupEventType, string> = {
  conference: "Conference",
  academic_program: "Academic program",
  meetup: "Meetup",
  internal: "Internal",
  pd_day: "PD day / Training",
  talk_showcase: "Talk showcase",
};

/**
 * TALK-1 — size guidance when the event is a Talk showcase. Descriptive
 * TEDx mention only (license fact); the in-product name stays Talk showcase.
 */
export const TALK_SHOWCASE_SIZE_HELPER =
  "Standard TEDx licenses cap in-person attendance at 100";

export function setupEventTypeLabel(type: SetupEventType | ""): string {
  return type ? SETUP_EVENT_TYPE_LABEL[type] : "";
}

/**
 * Order matters: Talk showcase (tedx / lightning talk / speaker series)
 * wins over conference/internal so those phrases do not land on a generic
 * type. PD wins over the academic patterns so "PD program" and
 * "training program" route to pd_day. Bare "program" is only academic when
 * it is academically qualified ("academic program", "doctoral program") —
 * on its own it is too generic to route anywhere.
 */
const TYPE_PATTERNS: Array<{ type: SetupEventType; re: RegExp }> = [
  {
    type: "talk_showcase",
    re: /\b(tedx|talk showcase|storytelling|lightning talks?|pecha[\s-]?kucha|speaker series)\b/i,
  },
  {
    type: "pd_day",
    re: /\b(pd|p\.d\.|professional development|professional learning|in-?service|inset|training|staff development)\b/i,
  },
  {
    type: "academic_program",
    re: /\b(academic|doctoral|phd|graduate|seminar series)\b|\b(?:academic|doctoral|phd|graduate|masters|master'?s|research)\s+program\b/i,
  },
  { type: "meetup", re: /\b(meetup|meet-up|casual|community hangout)\b/i },
  { type: "internal", re: /\b(internal|company|offsite|all-?hands|team)\b/i },
  { type: "conference", re: /\b(conference|summit|symposium|forum)\b/i },
];

export function parseEventType(text: string): SetupEventType | null {
  for (const p of TYPE_PATTERNS) {
    if (p.re.test(text)) return p.type;
  }
  const t = text.trim().toLowerCase();
  if (t === "1" || t === "a") return "conference";
  if (t === "2" || t === "b") return "academic_program";
  if (t === "3" || t === "c") return "meetup";
  if (t === "4" || t === "d") return "internal";
  if (t === "5" || t === "e") return "pd_day";
  if (t === "6" || t === "f") return "talk_showcase";
  return null;
}

export type SetupCopilotMode = "create" | "settings";

export type SetupCopilotStep =
  | "name"
  | "dates"
  | "venue"
  | "size"
  | "type"
  | "networking"
  | "document"
  | "ready"
  | "settings_chat";

/** Visible form state filled alongside the chat — the conversation IS the wizard. */
export type SetupCopilotFormState = {
  name: string;
  startDate: string; // ISO date or datetime-local-friendly
  endDate: string;
  timezone: string;
  /** True once the organizer or extraction sets timezone (not just the browser default). */
  timezoneExplicit: boolean;
  venueName: string;
  venueAddress: string;
  onlineUrl: string;
  estimatedSize: string;
  eventType: SetupEventType | "";
  hasProgramDocument: boolean | null;
  featureOverrides: Partial<Record<FeatureKey, FeatureOverrideValue>>;
  /** Suggested preset from event type (applied as starting point when type is set). */
  suggestedPreset: FeaturePresetId | null;
  networkingChoice: "full" | "focused" | "custom" | null;
};

export type SetupCopilotMessage = {
  role: "assistant" | "user";
  content: string;
  aiGenerated?: boolean;
  /**
   * AGENT-3 — deterministic in-app navigation offers attached server-side
   * (Organizer Guide anchors matched in the reply). Never model output.
   */
  links?: ConciergeLink[];
};

export type ConfigDiffEntry = {
  key: FeatureKey;
  name: string;
  plainDescription: string;
  from: FeatureOverrideValue | "default";
  to: FeatureOverrideValue;
  /** Why this row appears (user request vs dependency cascade). */
  reason: "requested" | "dependency" | "preset";
  dependencyNote?: string;
  /** Live-event impact note (settings mode only). */
  liveImpact?: string;
};

export type ConfigDiffCard = {
  title: string;
  summary: string;
  entries: ConfigDiffEntry[];
  proposedOverrides: Partial<Record<FeatureKey, FeatureOverrideValue>>;
  aiGenerated: true;
};

export type SetupHandoffA1 = {
  kind: "agenda_ingest";
  message: string;
  /** Relative path organizer should open with file attached. */
  ingestPath: string;
};

export type OnboardingChecklistItem = {
  key: "create_event" | "add_sessions" | "invite_attendees" | "publish";
  label: string;
  done: boolean;
};

export const PHASE6_ONBOARDING_CHECKLIST: OnboardingChecklistItem[] = [
  { key: "create_event", label: "Create event", done: false },
  { key: "add_sessions", label: "Add sessions", done: false },
  { key: "invite_attendees", label: "Invite attendees", done: false },
  { key: "publish", label: "Publish", done: false },
];

export const EVENT_TYPE_PRESET: Record<SetupEventType, FeaturePresetId> = {
  conference: "everything",
  academic_program: "academic",
  meetup: "everything",
  internal: "focused",
  pd_day: "pd_day",
  talk_showcase: "talk_showcase",
};

/** Prefill ≤100 when Talk showcase is chosen and the organizer has not sized it yet. */
export function applyTalkShowcaseSizePrefill(form: SetupCopilotFormState): SetupCopilotFormState {
  if (form.eventType !== "talk_showcase") return form;
  if (form.estimatedSize.trim()) return form;
  return { ...form, estimatedSize: "100" };
}

/** Event-details label: honest that the pre-fill is the organizer's local zone. */
export function setupTimezoneFieldLabel(explicit: boolean): string {
  return explicit ? "Timezone" : "Timezone (your local default)";
}

export function emptySetupFormState(timezone = "UTC"): SetupCopilotFormState {
  return {
    name: "",
    startDate: "",
    endDate: "",
    timezone,
    timezoneExplicit: false,
    venueName: "",
    venueAddress: "",
    onlineUrl: "",
    estimatedSize: "",
    eventType: "",
    hasProgramDocument: null,
    featureOverrides: {},
    suggestedPreset: null,
    networkingChoice: null,
  };
}

/** Live-event impact copy when turning a feature off. */
export const LIVE_FEATURE_IMPACT: Partial<Record<FeatureKey, string>> = {
  community: "Community is hidden immediately; existing posts are preserved.",
  community_icebreakers: "Ice-breaker channel is hidden; existing posts are preserved.",
  community_moments: "Photo sharing is hidden; existing posts are preserved.",
  community_meetups: "Meet-ups channel is hidden; existing posts are preserved.",
  community_local: "Local recommendations are hidden; existing posts are preserved.",
  community_general: "General board is hidden; existing posts are preserved.",
  timezone_toggle: "Attendees see event timezone only — the local/event toggle disappears immediately.",
  attendee_directory: "Directory is hidden immediately; opt-in profiles are preserved.",
  matchmaker: "Matchmaker is hidden immediately; prior suggestions stay in history.",
  messaging_dms: "Direct messages are hidden; existing threads are preserved.",
  messaging_groups: "Group chats are hidden; existing threads are preserved.",
  messaging_event_chat: "Event chat is hidden; existing messages are preserved.",
  session_qa: "Session Q&A is hidden; existing threads are preserved.",
  session_likes: "Likes stop appearing; existing like counts are preserved.",
  venue_maps: "Venue maps are hidden; floor plans are preserved.",
  sponsor_outreach: "The outreach pipeline is hidden; existing prospects stay.",
};
