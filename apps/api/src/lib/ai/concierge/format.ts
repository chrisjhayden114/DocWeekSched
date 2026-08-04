/**
 * E19.2/E19.3 — event-timezone formatting for Event assistant answers.
 * Attendee-facing times are always in the EVENT's timezone, and "no match"
 * answers must name the real reason (e.g. when the event actually runs).
 */

type EventWindow = {
  name: string;
  timezone: string;
  startDate: Date;
  endDate: Date;
};

export function zonedDayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function zonedHour(date: Date, timeZone: string): number {
  const value = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(date)
    .find((p) => p.type === "hour")?.value;
  return Number(value || "0");
}

/** "Jun 8 – Jun 10, 2026" (single date when the event is one day). */
export function formatEventDateRange(event: EventWindow): string {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: event.timezone,
    month: "short",
    day: "numeric",
  });
  const year = new Intl.DateTimeFormat("en-US", {
    timeZone: event.timezone,
    year: "numeric",
  }).format(event.endDate);
  const start = day.format(event.startDate);
  const end = day.format(event.endDate);
  return start === end ? `${start}, ${year}` : `${start} – ${end}, ${year}`;
}

/** "Mon, Jun 8, 9:00 AM–10:15 AM EDT" in the event timezone. */
export function formatSessionTime(
  startsAt: Date,
  endsAt: Date,
  timeZone: string,
): string {
  const dayPart = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(startsAt);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
  const zone =
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
      .formatToParts(startsAt)
      .find((p) => p.type === "timeZoneName")?.value || "";
  return `${dayPart}, ${time.format(startsAt)}–${time.format(endsAt)}${zone ? ` ${zone}` : ""}`;
}

/** True when `now` falls inside the event's date range (event timezone, inclusive). */
export function isDuringEvent(event: EventWindow, now: Date): boolean {
  const today = zonedDayKey(now, event.timezone);
  return (
    today >= zonedDayKey(event.startDate, event.timezone) &&
    today <= zonedDayKey(event.endDate, event.timezone)
  );
}
