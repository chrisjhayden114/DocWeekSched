/**
 * Parse plain-language organizer answers for the mock setup dialogue.
 */

import { parseEventType, type FeatureKey, type FeatureOverrideValue } from "@event-app/shared";

export { parseEventType };

const MONTH_NAMES =
  "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";

const ORDINAL = "(?:st|nd|rd|th)";

/**
 * Strip conversational lead-ins and prefer a quoted title when present.
 * "OK, sure its \"Time to Fly\"" → "Time to Fly"
 */
export function parseEventName(text: string): string | null {
  const raw = text.trim();
  if (!raw) return null;

  const quoted = raw.match(/["“”']([^"“”']+)["“”']/);
  if (quoted?.[1]?.trim()) return quoted[1].trim().slice(0, 200);

  let t = raw;
  t = t.replace(/^(?:ok(?:ay)?|sure|yes|yeah|yep)[,.]?\s+/gi, "").trim();
  t = t.replace(
    /^(?:it'?s|its|it is|call it|let'?s say|lets say|the name is|we(?:'re| are) calling it|name(?:'s| is))\s+/i,
    "",
  ).trim();
  t = t.replace(/^["“”']+|["“”']+$/g, "").trim();
  if (!t) return null;
  return t.slice(0, 200);
}

/** Extract YYYY-MM-DD range and optional timezone from free text. */
export function parseDatesAndTimezone(
  text: string,
  fallbackTz: string,
): { startDate: string; endDate: string; timezone: string; timezoneExplicit: boolean } | null {
  const isoRange = text.match(
    /(\d{4}-\d{2}-\d{2})(?:\s*(?:to|through|-|–|—)\s*(\d{4}-\d{2}-\d{2}))?/i,
  );
  let startDate = "";
  let endDate = "";
  if (isoRange) {
    startDate = isoRange[1];
    endDate = isoRange[2] || isoRange[1];
  } else {
    // Day-first ordinal range: "1st - 5th December 2026"
    const dayFirst = text.match(
      new RegExp(
        `\\b(\\d{1,2})${ORDINAL}?(?:\\s*[-–—]\\s*(\\d{1,2})${ORDINAL}?)?\\s+(${MONTH_NAMES})(?:\\s*,?\\s*(\\d{4}))?`,
        "i",
      ),
    );
    // Month-first: "July 20-22, 2027". `(?!\\d)` so "December 2026" is not day 20.
    const monthFirst = text.match(
      new RegExp(
        `\\b(${MONTH_NAMES})\\s+(\\d{1,2})(?!\\d)(?:\\s*[-–—]\\s*(\\d{1,2})(?!\\d))?(?:,?\\s*(\\d{4}))?`,
        "i",
      ),
    );
    const m = dayFirst || monthFirst;
    if (!m) return null;
    const year = Number(m[4] || new Date().getFullYear() + 1);
    if (dayFirst && m === dayFirst) {
      const month = monthToNum(m[3]);
      const d1 = Number(m[1]);
      const d2 = m[2] ? Number(m[2]) : d1;
      startDate = ymd(year, month, d1);
      endDate = ymd(year, month, d2);
    } else {
      const month = monthToNum(m[1]);
      const d1 = Number(m[2]);
      const d2 = m[3] ? Number(m[3]) : d1;
      startDate = ymd(year, month, d1);
      endDate = ymd(year, month, d2);
    }
  }

  let timezone = fallbackTz;
  let timezoneExplicit = false;
  const tzMatch = text.match(
    /\b(UTC|GMT|[A-Za-z]+\/[A-Za-z_]+|America\/[A-Za-z_]+|Europe\/[A-Za-z_]+|Asia\/[A-Za-z_]+|Pacific\/[A-Za-z_]+)\b/,
  );
  if (tzMatch) {
    timezone = tzMatch[1];
    timezoneExplicit = true;
  } else if (/\b(PT|Pacific Time|Los Angeles)\b/i.test(text)) {
    timezone = "America/Los_Angeles";
    timezoneExplicit = true;
  } else if (/\b(ET|Eastern Time|New York)\b/i.test(text)) {
    timezone = "America/New_York";
    timezoneExplicit = true;
  } else if (/\b(CT|Central Time|Chicago)\b/i.test(text)) {
    timezone = "America/Chicago";
    timezoneExplicit = true;
  } else if (/\b(MT|Mountain Time|Denver)\b/i.test(text)) {
    timezone = "America/Denver";
    timezoneExplicit = true;
  }

  return { startDate, endDate, timezone, timezoneExplicit };
}

function monthToNum(name: string): number {
  const n = name.toLowerCase().slice(0, 3);
  const map: Record<string, number> = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  };
  return map[n] || 1;
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const VENUE_MAX = 80;
const VENUE_HEADCOUNT = /~\s*\d+|\d+\s*(?:people|attendees|participants|teachers)\b/i;

function isVenueSentence(raw: string): boolean {
  if (/,\s*thinking\b/i.test(raw) || /\sexpecting\b/i.test(raw)) return true;
  const commas = (raw.match(/,/g) ?? []).length;
  return commas >= 2 && /\d/.test(raw);
}

/** Place name only — drop descriptions, headcounts, and multi-clause sentences. */
export function cleanVenueName(raw: string): string | null {
  const v = raw.trim();
  if (!v || v.length > VENUE_MAX) return null;
  if (VENUE_HEADCOUNT.test(v) || isVenueSentence(v)) return null;
  return v;
}

export function parseVenue(text: string): {
  venueName: string;
  venueAddress: string;
  onlineUrl: string;
} {
  const t = text.trim();
  if (/^(online|virtual|remote|zoom|teams)\b/i.test(t) || /\bonline only\b/i.test(t)) {
    const url = t.match(/https?:\/\/\S+/)?.[0] || "";
    return { venueName: "", venueAddress: "", onlineUrl: url || "https://online.example" };
  }
  if (/\bhybrid\b/i.test(t)) {
    const url = t.match(/https?:\/\/\S+/)?.[0] || "";
    const name = t.replace(/\bhybrid\b/i, "").replace(/https?:\/\/\S+/, "").trim() || "Hybrid venue";
    return { venueName: cleanVenueName(name) ?? "", venueAddress: "", onlineUrl: url };
  }
  return { venueName: cleanVenueName(t) ?? "", venueAddress: "", onlineUrl: "" };
}

export function parseSize(text: string): string | null {
  const stripped = text.trim().replace(/^(?:~|about|roughly)\s*/i, "");
  const m = stripped.match(/(\d{1,6})/);
  return m ? m[1] : null;
}

export function parseYesNo(text: string): boolean | null {
  const t = text.trim().toLowerCase();
  if (/^(y|yes|yeah|yep|true|1)\b/.test(t) || /\b(i have|we have|yes)\b/.test(t)) return true;
  if (/^(n|no|nope|false|0)\b/.test(t) || /\b(don'?t have|no document|not yet)\b/.test(t)) return false;
  return null;
}

export function parseNetworkingChoice(text: string): "full" | "focused" | "custom" | null {
  if (/\b(full|everything|networking|community|ice-?breakers?|photo)\b/i.test(text) && !/\bno\b/i.test(text)) {
    if (/\bfocused|schedule only|just the schedule|keep it focused\b/i.test(text)) return "focused";
    return "full";
  }
  if (/\b(focused|schedule only|just the schedule|quiet|minimal)\b/i.test(text)) return "focused";
  return null;
}

/**
 * Detect specific feature toggle requests from plain language.
 * Example: "no ice-breakers, and everyone's local so don't show timezone conversion"
 */
export function parseFeatureRequests(text: string): {
  patch: Partial<Record<FeatureKey, FeatureOverrideValue>>;
  requestedKeys: FeatureKey[];
  isCustomRequest: boolean;
} {
  const patch: Partial<Record<FeatureKey, FeatureOverrideValue>> = {};
  const requestedKeys: FeatureKey[] = [];
  const t = text.toLowerCase();

  const turnOff = (key: FeatureKey) => {
    patch[key] = false;
    requestedKeys.push(key);
  };
  const turnOn = (key: FeatureKey) => {
    patch[key] = true;
    requestedKeys.push(key);
  };

  if (/\b(no|without|disable|turn off|don't|dont|hide)\b.{0,40}\bice-?breakers?\b/i.test(text) || /\bice-?breakers?\b.{0,20}\b(off|disabled)\b/i.test(text)) {
    turnOff("community_icebreakers");
  }
  if (
    /\b(no|without|disable|turn off|don't|dont|hide)\b.{0,40}\b(timezone|time zone|tz)\b/i.test(text) ||
    /\beveryone'?s?\s+local\b/i.test(text) ||
    /\bdon'?t show timezone\b/i.test(text) ||
    /\bno timezone conversion\b/i.test(text)
  ) {
    turnOff("timezone_toggle");
  }
  if (/\b(no|without|disable|turn off)\b.{0,40}\b(moments|photo|photos)\b/i.test(text)) {
    turnOff("community_moments");
  }
  if (/\b(no|without|disable|turn off)\b.{0,40}\b(directory|attendee list)\b/i.test(text)) {
    turnOff("attendee_directory");
  }
  if (/\b(no|without|disable|turn off)\b.{0,40}\bcommunity\b/i.test(text)) {
    turnOff("community");
  }
  if (/\b(enable|turn on|want)\b.{0,40}\bice-?breakers?\b/i.test(text) && !/\bno\b/i.test(t)) {
    turnOn("community_icebreakers");
  }

  return {
    patch,
    requestedKeys,
    isCustomRequest: requestedKeys.length > 0,
  };
}
