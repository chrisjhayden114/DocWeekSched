/**
 * Phase A2 — Event Setup Copilot shared types.
 * Conversation state is client-held; server is stateless per turn.
 */

import type { FeatureKey, FeatureOverrideValue, FeaturePresetId } from "./features";

export type SetupEventType = "conference" | "academic_program" | "meetup" | "internal";

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
};

export function emptySetupFormState(timezone = "UTC"): SetupCopilotFormState {
  return {
    name: "",
    startDate: "",
    endDate: "",
    timezone,
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
};
