/**
 * Parse plain-language organizer answers for the mock setup dialogue.
 */

import type { FeatureKey, FeatureOverrideValue, SetupEventType } from "@event-app/shared";

const TYPE_PATTERNS: Array<{ type: SetupEventType; re: RegExp }> = [
  { type: "academic_program", re: /\b(academic|doctoral|phd|graduate|seminar series|program)\b/i },
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
  return null;
}

/** Extract YYYY-MM-DD range and optional timezone from free text. */
export function parseDatesAndTimezone(
  text: string,
  fallbackTz: string,
): { startDate: string; endDate: string; timezone: string } | null {
  const isoRange = text.match(
    /(\d{4}-\d{2}-\d{2})(?:\s*(?:to|through|-|–|—)\s*(\d{4}-\d{2}-\d{2}))?/i,
  );
  let startDate = "";
  let endDate = "";
  if (isoRange) {
    startDate = isoRange[1];
    endDate = isoRange[2] || isoRange[1];
  } else {
    // e.g. July 20-22, 2027 or Jul 20 – Jul 22 2027
    const monthNames =
      "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";
    const m = text.match(
      new RegExp(
        `\\b(${monthNames})\\s+(\\d{1,2})(?:\\s*[-–—]\\s*(\\d{1,2}))?(?:,?\\s*(\\d{4}))?`,
        "i",
      ),
    );
    if (!m) return null;
    const year = Number(m[4] || new Date().getFullYear() + 1);
    const month = monthToNum(m[1]);
    const d1 = Number(m[2]);
    const d2 = m[3] ? Number(m[3]) : d1;
    startDate = ymd(year, month, d1);
    endDate = ymd(year, month, d2);
  }

  let timezone = fallbackTz;
  const tzMatch = text.match(
    /\b(UTC|GMT|[A-Za-z]+\/[A-Za-z_]+|America\/[A-Za-z_]+|Europe\/[A-Za-z_]+|Asia\/[A-Za-z_]+|Pacific\/[A-Za-z_]+)\b/,
  );
  if (tzMatch) timezone = tzMatch[1];
  else if (/\b(PT|Pacific Time|Los Angeles)\b/i.test(text)) timezone = "America/Los_Angeles";
  else if (/\b(ET|Eastern Time|New York)\b/i.test(text)) timezone = "America/New_York";
  else if (/\b(CT|Central Time|Chicago)\b/i.test(text)) timezone = "America/Chicago";
  else if (/\b(MT|Mountain Time|Denver)\b/i.test(text)) timezone = "America/Denver";

  return { startDate, endDate, timezone };
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
    return { venueName: name, venueAddress: "", onlineUrl: url };
  }
  return { venueName: t.slice(0, 200), venueAddress: "", onlineUrl: "" };
}

export function parseSize(text: string): string | null {
  const m = text.match(/(\d{1,6})/);
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
