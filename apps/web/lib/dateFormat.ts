/**
 * One date/time format for attendee surfaces (Phase 4.5).
 * Example: "Mon, Jun 8 · 9:00 AM EDT"
 */

function timeZoneAbbrev(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "short",
    }).formatToParts(date);
    return parts.find((p) => p.type === "timeZoneName")?.value || timeZone;
  } catch {
    return timeZone;
  }
}

/** Single instant: "Mon, Jun 8 · 9:00 AM EDT" */
export function formatEventDateTime(iso: string | Date, timeZone = "UTC"): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return "";
  try {
    const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).format(date);
    const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone }).format(date);
    const day = new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone }).format(date);
    const time = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(date);
    return `${weekday}, ${month} ${day} · ${time} ${timeZoneAbbrev(date, timeZone)}`;
  } catch {
    return date.toLocaleString();
  }
}

/** Time range on one day: "Mon, Jun 8 · 9:00 AM – 10:30 AM EDT" */
export function formatEventTimeRange(
  startIso: string | Date,
  endIso: string | Date,
  timeZone = "UTC",
): string {
  const start = typeof startIso === "string" ? new Date(startIso) : startIso;
  const end = typeof endIso === "string" ? new Date(endIso) : endIso;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";
  try {
    const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).format(start);
    const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone }).format(start);
    const day = new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone }).format(start);
    const startTime = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(start);
    const endTime = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(end);
    return `${weekday}, ${month} ${day} · ${startTime} – ${endTime} ${timeZoneAbbrev(start, timeZone)}`;
  } catch {
    return `${start.toLocaleString()} – ${end.toLocaleString()}`;
  }
}

/** Day bucket label for notification grouping: "Mon, Jun 8" (local calendar day). */
export function formatDayHeading(iso: string | Date, timeZone?: string): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      ...(timeZone ? { timeZone } : {}),
    }).format(date);
  } catch {
    return date.toDateString();
  }
}

/** Relative time for community posts: "just now", "5m ago", "2h ago", "Mon, Jun 8". */
export function formatRelativeTime(iso: string | Date, now = new Date()): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return formatDayHeading(date);
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDayHeading(date);
}

export { timeZoneAbbrev };
