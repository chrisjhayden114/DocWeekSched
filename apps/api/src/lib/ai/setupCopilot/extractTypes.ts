/**
 * Pure extract types + merge helpers — safe for the dialogue layer
 * (no gateway / Prisma on import).
 *
 * SETUP-2.1: extracted values are never merged raw. validateExtracted
 * drops invalid fields (treated as null); merge applies the rest.
 */

import {
  EVENT_TYPE_PRESET,
  applyPreset,
  type SetupCopilotFormState,
  type SetupCopilotStep,
  type SetupEventType,
} from "@event-app/shared";
import { cleanVenueName, parseEventName } from "./parse";

export type SetupExtract = {
  name?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  timezone?: string | null;
  venueName?: string | null;
  onlineUrl?: string | null;
  estimatedSize?: number | string | null;
  eventType?: SetupEventType | null;
  networkingChoice?: "full" | "focused" | "custom" | null;
  networkingNote?: string | null;
  hasProgramDocument?: boolean | null;
  /** Daily hours as HH:MM — mapped onto first/last stored date-times. */
  dayStartTime?: string | null;
  dayEndTime?: string | null;
};

export type ValidateExtractContext = {
  /** The same user/document text the extract was taken from. */
  userText?: string;
  knownStartDate?: string | null;
  knownEndDate?: string | null;
};

const NAME_MAX = 120;
const VENUE_MAX = 80;
const SIZE_MIN = 2;
const SIZE_MAX = 100000;
const HEADCOUNT_WORD = /\b(people|attendees|teachers|participants)\b/i;
const SIZE_APPROX_PREFIX = /^(?:~|about|roughly)\s*/i;
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})/;
const HM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function hasExtractedFields(data: SetupExtract | null | undefined): boolean {
  if (!data) return false;
  return Object.values(data).some((v) => v !== null && v !== undefined && v !== "");
}

function nonEmpty(v: string | null | undefined): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function datePart(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = YMD_RE.exec(v.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function isRealYmd(ymd: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function withinFiveYearsOfToday(ymd: string, today = new Date()): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return false;
  const dt = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const min = new Date(today.getFullYear() - 5, today.getMonth(), today.getDate());
  const max = new Date(today.getFullYear() + 5, today.getMonth(), today.getDate());
  const lo = Date.UTC(min.getFullYear(), min.getMonth(), min.getDate());
  const hi = Date.UTC(max.getFullYear(), max.getMonth(), max.getDate());
  return dt >= lo && dt <= hi;
}

function yearsFrom(...vals: Array<string | null | undefined>): Set<number> {
  const years = new Set<number>();
  for (const v of vals) {
    if (!v) continue;
    const m = /^(\d{4})/.exec(v.trim());
    if (m) years.add(Number(m[1]));
  }
  return years;
}

export function isValidIanaTimeZone(tz: string): boolean {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] };
  if (typeof intl.supportedValuesOf === "function" && intl.supportedValuesOf("timeZone").includes(tz)) {
    return true;
  }
  // UTC/GMT are valid zones for DateTimeFormat but are not always in the
  // supportedValuesOf list. Fake Area/Location strings still throw.
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeHm(raw: string): string | null {
  const m = HM_RE.exec(raw.trim());
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

function quotedTitle(text: string): string | null {
  const quoted = text.match(/["“”']([^"“”']+)["“”']/);
  const name = quoted?.[1]?.trim();
  return name || null;
}

function cleanExtractedName(raw: string): string | null {
  const stripped = parseEventName(raw) ?? raw.trim();
  return stripped || null;
}

/** Strip ~/about/roughly, then parse an integer headcount. */
export function parseEstimatedSizeInput(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isInteger(raw) ? raw : null;
  }
  if (typeof raw !== "string") return null;
  const stripped = raw.trim().replace(SIZE_APPROX_PREFIX, "");
  if (!/^\d/.test(stripped)) return null;
  const n = Number.parseInt(stripped, 10);
  return Number.isInteger(n) ? n : null;
}

/**
 * Deterministic validation: invalid fields are dropped (null), never
 * coerced into form state. Call before merge; merge also re-runs this.
 */
export function validateExtracted(
  fields: SetupExtract,
  context: ValidateExtractContext = {},
): SetupExtract {
  const next: SetupExtract = { ...fields };

  let name: string | null = null;
  if (nonEmpty(fields.name)) name = cleanExtractedName(fields.name);
  if (!name && context.userText) name = quotedTitle(context.userText);
  if (!name || name.length > NAME_MAX) next.name = null;
  else next.name = name;

  const startYmd = datePart(fields.startDate);
  const endYmd = datePart(fields.endDate);
  const startOk = startYmd && isRealYmd(startYmd) && withinFiveYearsOfToday(startYmd);
  const endOk = endYmd && isRealYmd(endYmd) && withinFiveYearsOfToday(endYmd);
  if (startOk && endOk && endYmd < startYmd) {
    next.startDate = null;
    next.endDate = null;
  } else {
    next.startDate = startOk ? startYmd : null;
    next.endDate = endOk ? endYmd : null;
  }

  if (nonEmpty(fields.timezone) && isValidIanaTimeZone(fields.timezone.trim())) {
    next.timezone = fields.timezone.trim();
  } else {
    next.timezone = null;
  }

  if (nonEmpty(fields.onlineUrl) && isHttpUrl(fields.onlineUrl.trim())) {
    next.onlineUrl = fields.onlineUrl.trim();
  } else {
    next.onlineUrl = null;
  }

  if (nonEmpty(fields.venueName)) {
    next.venueName = cleanVenueName(fields.venueName);
  } else {
    next.venueName = null;
  }

  const size = parseEstimatedSizeInput(fields.estimatedSize);
  const sizeOk = size != null && size >= SIZE_MIN && size <= SIZE_MAX;
  if (!sizeOk) {
    next.estimatedSize = null;
  } else {
    const years = yearsFrom(
      fields.startDate,
      fields.endDate,
      context.knownStartDate,
      context.knownEndDate,
    );
    const looksLikeYear = years.has(size);
    const explicitHeadcount = HEADCOUNT_WORD.test(context.userText ?? "");
    next.estimatedSize = looksLikeYear && !explicitHeadcount ? null : size;
  }

  next.dayStartTime = nonEmpty(fields.dayStartTime) ? normalizeHm(fields.dayStartTime) : null;
  next.dayEndTime = nonEmpty(fields.dayEndTime) ? normalizeHm(fields.dayEndTime) : null;

  return next;
}

function applyDayWindow(
  form: SetupCopilotFormState,
  extracted: SetupExtract,
): { startDate?: string; endDate?: string } {
  const startYmd = datePart(extracted.startDate) ?? datePart(form.startDate);
  const endYmd = datePart(extracted.endDate) ?? datePart(form.endDate) ?? startYmd;
  const out: { startDate?: string; endDate?: string } = {};
  if (startYmd && extracted.dayStartTime) {
    out.startDate = `${startYmd}T${extracted.dayStartTime}`;
  }
  if (endYmd && extracted.dayEndTime) {
    out.endDate = `${endYmd}T${extracted.dayEndTime}`;
  }
  return out;
}

/**
 * Deterministic merge: extracted non-null values overwrite; nothing is
 * ever cleared. Empty strings are treated as absent. Values are validated
 * first — invalid fields are dropped, not merged.
 */
export function mergeSetupExtract(
  form: SetupCopilotFormState,
  extracted: SetupExtract,
  context: ValidateExtractContext = {},
): SetupCopilotFormState {
  const valid = validateExtracted(extracted, {
    userText: context.userText,
    knownStartDate: context.knownStartDate ?? form.startDate,
    knownEndDate: context.knownEndDate ?? form.endDate,
  });

  let next: SetupCopilotFormState = { ...form };
  if (nonEmpty(valid.name)) next.name = valid.name.trim().slice(0, NAME_MAX);
  if (nonEmpty(valid.startDate)) next.startDate = valid.startDate;
  if (nonEmpty(valid.endDate)) next.endDate = valid.endDate;
  if (nonEmpty(valid.timezone)) {
    next.timezone = valid.timezone.trim();
    next.timezoneExplicit = true;
  }
  if (nonEmpty(valid.venueName)) next.venueName = valid.venueName.trim().slice(0, VENUE_MAX);
  if (nonEmpty(valid.onlineUrl)) next.onlineUrl = valid.onlineUrl.trim();
  if (valid.estimatedSize != null && Number.isFinite(valid.estimatedSize)) {
    next.estimatedSize = String(valid.estimatedSize);
  }
  if (valid.eventType) {
    next.eventType = valid.eventType;
    const preset = EVENT_TYPE_PRESET[valid.eventType];
    next = {
      ...next,
      suggestedPreset: preset,
      featureOverrides: { ...next.featureOverrides, ...applyPreset(preset) },
    };
  }
  if (valid.networkingChoice === "full") {
    next = {
      ...next,
      networkingChoice: "full",
      featureOverrides: { ...next.featureOverrides, ...applyPreset("everything") },
    };
  } else if (valid.networkingChoice === "focused") {
    next = {
      ...next,
      networkingChoice: "focused",
      featureOverrides: { ...next.featureOverrides, ...applyPreset("focused") },
    };
  } else if (valid.networkingChoice === "custom") {
    next = { ...next, networkingChoice: "custom" };
  }
  if (valid.hasProgramDocument !== null && valid.hasProgramDocument !== undefined) {
    next.hasProgramDocument = valid.hasProgramDocument;
  }

  const windowed = applyDayWindow(next, valid);
  if (windowed.startDate) next.startDate = windowed.startDate;
  if (windowed.endDate) next.endDate = windowed.endDate;

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

/** Heuristic: a document with several timed rows is probably a session program. */
export function looksLikeProgramDocument(text: string): boolean {
  const timeRe =
    /\b(?:[01]?\d|2[0-3])[:.][0-5]\d(?:\s*[-–—]\s*(?:[01]?\d|2[0-3])[:.][0-5]\d)?\b/g;
  const matches = text.match(timeRe);
  return (matches?.length ?? 0) >= 4;
}
