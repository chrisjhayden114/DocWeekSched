/**
 * Pure extract types + merge helpers — safe for the dialogue layer
 * (no gateway / Prisma on import).
 */

import {
  EVENT_TYPE_PRESET,
  applyPreset,
  type SetupCopilotFormState,
  type SetupCopilotStep,
  type SetupEventType,
} from "@event-app/shared";

export type SetupExtract = {
  name?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  timezone?: string | null;
  venueName?: string | null;
  onlineUrl?: string | null;
  estimatedSize?: number | null;
  eventType?: SetupEventType | null;
  networkingChoice?: "full" | "focused" | "custom" | null;
  networkingNote?: string | null;
  hasProgramDocument?: boolean | null;
};

export function hasExtractedFields(data: SetupExtract | null | undefined): boolean {
  if (!data) return false;
  return Object.values(data).some((v) => v !== null && v !== undefined && v !== "");
}

function nonEmpty(v: string | null | undefined): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isYmd(v: string | null | undefined): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/** Many timed rows → an obvious session program, not just event metadata. */
export function looksLikeProgramDocument(text: string): boolean {
  const timeRe =
    /\b(?:[01]?\d|2[0-3])[:.][0-5]\d(?:\s*[-–—]\s*(?:[01]?\d|2[0-3])[:.][0-5]\d)?\b/g;
  const matches = text.match(timeRe);
  return (matches?.length ?? 0) >= 4;
}

/**
 * Deterministic merge: extracted non-null values overwrite; nothing is
 * ever cleared. Empty strings are treated as absent.
 */
export function mergeSetupExtract(
  form: SetupCopilotFormState,
  extracted: SetupExtract,
): SetupCopilotFormState {
  let next: SetupCopilotFormState = { ...form };
  if (nonEmpty(extracted.name)) next.name = extracted.name.trim().slice(0, 200);
  if (isYmd(extracted.startDate)) next.startDate = extracted.startDate;
  if (isYmd(extracted.endDate)) next.endDate = extracted.endDate;
  if (nonEmpty(extracted.timezone)) next.timezone = extracted.timezone.trim();
  if (nonEmpty(extracted.venueName)) next.venueName = extracted.venueName.trim().slice(0, 200);
  if (nonEmpty(extracted.onlineUrl)) next.onlineUrl = extracted.onlineUrl.trim();
  if (extracted.estimatedSize != null && Number.isFinite(extracted.estimatedSize)) {
    next.estimatedSize = String(Math.round(extracted.estimatedSize));
  }
  if (extracted.eventType) {
    next.eventType = extracted.eventType;
    const preset = EVENT_TYPE_PRESET[extracted.eventType];
    next = {
      ...next,
      suggestedPreset: preset,
      featureOverrides: { ...next.featureOverrides, ...applyPreset(preset) },
    };
  }
  if (extracted.networkingChoice === "full") {
    next = {
      ...next,
      networkingChoice: "full",
      featureOverrides: { ...next.featureOverrides, ...applyPreset("everything") },
    };
  } else if (extracted.networkingChoice === "focused") {
    next = {
      ...next,
      networkingChoice: "focused",
      featureOverrides: { ...next.featureOverrides, ...applyPreset("focused") },
    };
  } else if (extracted.networkingChoice === "custom") {
    next = { ...next, networkingChoice: "custom" };
  }
  if (extracted.hasProgramDocument !== null && extracted.hasProgramDocument !== undefined) {
    next.hasProgramDocument = extracted.hasProgramDocument;
  }
  return next;
}

/** First still-needed field; stay on `ready` once we get there. */
export function stepFromForm(form: SetupCopilotFormState, current: SetupCopilotStep): SetupCopilotStep {
  if (current === "ready" || current === "settings_chat") return current;
  if (!form.name) return "name";
  if (!form.startDate) return "dates";
  if (!form.venueName && !form.onlineUrl) return "venue";
  if (!form.estimatedSize) return "size";
  if (!form.eventType) return "type";
  if (!form.networkingChoice) return "networking";
  if (form.hasProgramDocument === null) return "document";
  return "ready";
}
