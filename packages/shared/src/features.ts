/**
 * Per-event feature registry (Phase 2.6) — shared by API + web.
 */

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
  | "messaging_groups"
  | "messaging_event_chat"
  | "session_qa"
  | "session_likes"
  | "engagement_points"
  | "public_leaderboard"
  | "timezone_toggle"
  | "attendee_directory"
  | "matchmaker"
  | "concierge"
  | "venue_maps"
  | "waitlist_visibility"
  | "daily_digest";

export type FeatureOverrideValue = boolean | "daily" | "weekly" | "interrupts_only";

export type FeatureDefinition = {
  key: FeatureKey;
  name: string;
  plainDescription: string;
  category: FeatureCategory;
  defaultOn: boolean;
  dependsOn?: FeatureKey[];
  plannedPhase?: string;
  defaultValue?: FeatureOverrideValue;
};

export const FEATURE_REGISTRY: FeatureDefinition[] = [
  {
    key: "community",
    name: "Community",
    plainDescription: "The whole Community section where people post and reply.",
    category: "community",
    defaultOn: true,
  },
  {
    key: "community_meetups",
    name: "Meet-ups",
    plainDescription: "Let people propose in-person or virtual meet-ups.",
    category: "community",
    defaultOn: true,
    dependsOn: ["community"],
  },
  {
    key: "community_moments",
    name: "Share your moments",
    plainDescription: "Photo sharing space for event moments.",
    category: "community",
    defaultOn: true,
    dependsOn: ["community"],
  },
  {
    key: "community_local",
    name: "Local recommendations",
    plainDescription: "Tips for places to eat, walk, and explore nearby.",
    category: "community",
    defaultOn: true,
    dependsOn: ["community"],
  },
  {
    key: "community_icebreakers",
    name: "Ice-breakers",
    plainDescription: "A friendly space for intros and conversation starters.",
    category: "community",
    defaultOn: true,
    dependsOn: ["community"],
  },
  {
    key: "community_general",
    name: "General board",
    plainDescription: "Open community posts that don’t fit a special channel.",
    category: "community",
    defaultOn: true,
    dependsOn: ["community"],
  },
  {
    key: "messaging_dms",
    name: "Direct messages",
    plainDescription: "One-to-one private chats between attendees.",
    category: "messaging",
    defaultOn: true,
  },
  {
    key: "messaging_groups",
    name: "Group chats",
    plainDescription: "Small group conversations attendees create together.",
    category: "messaging",
    defaultOn: true,
  },
  {
    key: "messaging_event_chat",
    name: "Event chat",
    plainDescription: "The shared chat room for everyone at the event.",
    category: "messaging",
    defaultOn: true,
  },
  {
    key: "session_qa",
    name: "Session Q&A",
    plainDescription: "Threaded questions and answers on each session page.",
    category: "sessions",
    defaultOn: true,
  },
  {
    key: "session_likes",
    name: "Likes on sessions",
    plainDescription: "Let attendees like sessions they are interested in.",
    category: "sessions",
    defaultOn: true,
  },
  {
    key: "engagement_points",
    name: "Engagement points",
    plainDescription: "Quiet points for participation (shown on profiles, not as a public contest).",
    category: "engagement",
    defaultOn: true,
  },
  {
    key: "public_leaderboard",
    name: "Public leaderboard",
    plainDescription: "Show a ranked list of attendees by engagement points.",
    category: "engagement",
    defaultOn: false,
    plannedPhase: "5",
    dependsOn: ["engagement_points"],
  },
  {
    key: "timezone_toggle",
    name: "Timezone toggle",
    plainDescription: "Let attendees switch between their local time and the event timezone.",
    category: "schedule",
    defaultOn: true,
  },
  {
    key: "attendee_directory",
    name: "Attendee directory",
    plainDescription: "A searchable list of people at the event.",
    category: "directory",
    defaultOn: true,
  },
  {
    key: "matchmaker",
    name: "Matchmaker",
    plainDescription: "Suggest people to meet based on shared interests.",
    category: "directory",
    defaultOn: false,
    dependsOn: ["attendee_directory"],
    plannedPhase: "4",
  },
  {
    key: "concierge",
    name: "Concierge",
    plainDescription: "An in-event assistant that answers questions from the agenda and FAQ.",
    category: "planned",
    defaultOn: false,
    plannedPhase: "A3",
  },
  {
    key: "venue_maps",
    name: "Venue maps",
    plainDescription: "Interactive floor plans with room pins.",
    category: "planned",
    defaultOn: false,
    plannedPhase: "P2",
  },
  {
    key: "waitlist_visibility",
    name: "Waitlist visibility",
    plainDescription: "Show waitlist position when a session is full.",
    category: "planned",
    defaultOn: false,
    plannedPhase: "P1",
  },
  {
    key: "daily_digest",
    name: "Daily digest",
    plainDescription: "How often quieter updates are bundled for attendees.",
    category: "engagement",
    defaultOn: true,
    defaultValue: "daily",
    plannedPhase: "4",
  },
];

export const FEATURE_BY_KEY: Record<FeatureKey, FeatureDefinition> = Object.fromEntries(
  FEATURE_REGISTRY.map((f) => [f.key, f]),
) as Record<FeatureKey, FeatureDefinition>;

export type FeaturePresetId = "everything" | "focused" | "academic";

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
      messaging_groups: true,
      messaging_event_chat: true,
      session_qa: true,
      session_likes: true,
      engagement_points: true,
      public_leaderboard: false,
      timezone_toggle: true,
      attendee_directory: true,
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
      messaging_groups: false,
      messaging_event_chat: false,
      session_qa: true,
      session_likes: false,
      engagement_points: false,
      public_leaderboard: false,
      timezone_toggle: true,
      attendee_directory: false,
      matchmaker: false,
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
      messaging_groups: true,
      messaging_event_chat: true,
      session_qa: true,
      session_likes: true,
      engagement_points: true,
      public_leaderboard: false,
      timezone_toggle: true,
      attendee_directory: true,
    },
  },
];

export function getOrganizerVisibleFeatures(): FeatureDefinition[] {
  return FEATURE_REGISTRY.filter((f) => !f.plannedPhase);
}

export function dependencyBlockReason(key: FeatureKey, effectiveOffParents: FeatureKey[]): string | null {
  if (!effectiveOffParents.length) return null;
  const def = FEATURE_BY_KEY[key];
  if (key === "matchmaker" && effectiveOffParents.includes("attendee_directory")) {
    return "Matchmaker needs the attendee directory";
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

  if (def.dependsOn?.includes("community")) {
    if (!resolveFeatureEnabled("community", overrides, opts)) return false;
  }
  if (def.dependsOn?.includes("attendee_directory")) {
    if (!resolveFeatureEnabled("attendee_directory", overrides, opts)) return false;
  }
  if (def.dependsOn?.includes("engagement_points")) {
    if (!resolveFeatureEnabled("engagement_points", overrides, opts)) return false;
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

  return { overrides, forcedOff };
}
