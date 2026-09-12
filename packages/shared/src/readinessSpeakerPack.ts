/**
 * TALK-1 — seeded "Speaker pack" readiness template for Talk showcase events.
 * Offered, never auto-created. No due dates — the organizer sets those.
 */

import type { FeatureKey, FeatureOverrideValue } from "./features";
import { applyPreset } from "./features";

export const SPEAKER_PACK_TEMPLATE_NAME = "Speaker pack";

export const SPEAKER_PACK_BUTTON_LABEL = "Start from the Speaker pack template";

/** One-sentence TED-style draft cadence — descriptive use only. */
export const SPEAKER_PACK_BUTTON_HELPER =
  "TED-style talk events usually collect a rough outline, then two script drafts, then a final script before rehearsal.";

export type SpeakerPackRequirementKind =
  | "short_text"
  | "long_text"
  | "confirm"
  | "multi_select"
  | "file"
  | "internal_checklist";

export type SpeakerPackRequirement = {
  label: string;
  kind: SpeakerPackRequirementKind;
  helpText?: string;
  config?: {
    options?: string[];
    /** ER4.3 — deck rules (size cap, allowlist) and AGENDA-3's share default. */
    deck?: boolean;
    /** AGENDA-3 — approving this requirement puts it on the attendee agenda. */
    shareByDefault?: boolean;
  };
  required?: boolean;
};

export const SPEAKER_PACK_REQUIREMENTS: readonly SpeakerPackRequirement[] = [
  { label: "Headshot", kind: "file" },
  { label: "Short bio ≤100 words", kind: "long_text" },
  { label: "Talk title & one-line description", kind: "short_text" },
  { label: "Rough outline", kind: "long_text" },
  { label: "Draft 1 script", kind: "file" },
  { label: "Draft 2 script", kind: "file" },
  { label: "Final script", kind: "file" },
  /**
   * AGENDA-3 — the one requirement in the pack that exists to be SEEN. Marking
   * it a deck gets it the deck upload rules, and shareByDefault puts it on the
   * agenda the moment an organizer approves it. Every other file here — the
   * headshot, the drafts, the signed release — stays organizer-only.
   */
  { label: "Slides 16:9", kind: "file", config: { deck: true, shareByDefault: true } },
  {
    label: "Signed speaker release",
    kind: "file",
    helpText: "upload the signed release PDF",
  },
  { label: "Copyright clearance", kind: "confirm" },
  {
    label: "AV needs",
    kind: "multi_select",
    config: {
      options: ["handheld mic", "headset", "clicker", "video in talk", "none"],
    },
  },
  { label: "Dress rehearsal confirmed", kind: "confirm" },
  { label: "Coach assigned", kind: "internal_checklist" },
  { label: "Rehearsal booked", kind: "internal_checklist" },
  { label: "Intro written", kind: "internal_checklist" },
];

const TALK_SHOWCASE_FINGERPRINT: readonly FeatureKey[] = [
  "session_qa",
  "session_polls",
  "breakout_style",
  "paid_attendance",
  "engagement_points",
  "timezone_toggle",
  "cfp",
  "sponsors",
  "checkin",
  "certificates",
  "community",
];

/** Distinctive Talk showcase toggles — used when event type is not stored. */
export function isTalkShowcaseFeatureSet(
  overrides: Partial<Record<FeatureKey, FeatureOverrideValue>>,
): boolean {
  const talk = applyPreset("talk_showcase");
  return TALK_SHOWCASE_FINGERPRINT.every((key) => overrides[key] === talk[key]);
}

/** Offer the seed only when readiness is on a Talk showcase event with no templates. */
export function shouldOfferSpeakerPack(opts: {
  templateCount: number;
  overrides: Partial<Record<FeatureKey, FeatureOverrideValue>>;
  setupEventType?: string | null;
}): boolean {
  if (opts.templateCount > 0) return false;
  if (opts.setupEventType === "talk_showcase") return true;
  return isTalkShowcaseFeatureSet(opts.overrides);
}
