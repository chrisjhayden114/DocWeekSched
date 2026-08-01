/**
 * IANA timezone list + search for the organizer timezone picker.
 * Uses Intl.supportedValuesOf("timeZone") when available; falls back to a
 * curated list on older runtimes.
 */

export const FALLBACK_TIMEZONES = [
  "Pacific/Honolulu",
  "America/Anchorage",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Toronto",
  "America/Halifax",
  "America/Mexico_City",
  "America/Bogota",
  "America/Lima",
  "America/Santiago",
  "America/Sao_Paulo",
  "America/Argentina/Buenos_Aires",
  "UTC",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Lisbon",
  "Europe/Madrid",
  "Europe/Paris",
  "Europe/Brussels",
  "Europe/Amsterdam",
  "Europe/Berlin",
  "Europe/Zurich",
  "Europe/Rome",
  "Europe/Stockholm",
  "Europe/Warsaw",
  "Europe/Athens",
  "Europe/Helsinki",
  "Europe/Istanbul",
  "Europe/Moscow",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Africa/Lagos",
  "Africa/Nairobi",
  "Asia/Jerusalem",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Bangkok",
  "Asia/Jakarta",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Taipei",
  "Asia/Seoul",
  "Asia/Tokyo",
  "Australia/Perth",
  "Australia/Adelaide",
  "Australia/Brisbane",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Pacific/Auckland",
];

type IntlWithSupportedValues = typeof Intl & {
  supportedValuesOf?: (key: "timeZone") => string[];
};

export function getTimezoneOptions(): string[] {
  try {
    const intl = Intl as IntlWithSupportedValues;
    if (typeof intl.supportedValuesOf === "function") {
      const zones = intl.supportedValuesOf("timeZone");
      if (Array.isArray(zones) && zones.length > 0) {
        // The runtime list omits plain "UTC" (only Etc/UTC); existing events use "UTC".
        return zones.includes("UTC") ? zones : ["UTC", ...zones];
      }
    }
  } catch {
    /* fall through to curated list */
  }
  return FALLBACK_TIMEZONES;
}

/**
 * Case-insensitive substring match; spaces match underscores so
 * "los angeles" finds "America/Los_Angeles".
 */
export function filterTimezones(zones: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return zones;
  const underscored = q.replace(/\s+/g, "_");
  return zones.filter((tz) => {
    const lower = tz.toLowerCase();
    return lower.includes(underscored) || lower.replace(/_/g, " ").includes(q);
  });
}

/** Current UTC offset for display, e.g. "UTC-07:00". Empty string if unknown. */
export function timezoneOffsetLabel(timeZone: string, date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longOffset",
    }).formatToParts(date);
    const raw = parts.find((p) => p.type === "timeZoneName")?.value || "";
    if (!raw) return "";
    if (raw === "GMT") return "UTC+00:00";
    return raw.replace(/^GMT/, "UTC");
  } catch {
    return "";
  }
}

/** True when the string is a usable IANA zone on this runtime. */
export function isValidTimezone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
