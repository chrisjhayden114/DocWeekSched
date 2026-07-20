import { localDayKey } from "../../notifications/timezone";

/** True when `date` falls on a calendar day of the event (inclusive start/end) in event TZ. */
export function isEventCalendarDay(
  date: Date,
  event: { startDate: Date; endDate: Date; timezone: string },
): boolean {
  const day = localDayKey(date, event.timezone);
  const start = localDayKey(event.startDate, event.timezone);
  const end = localDayKey(event.endDate, event.timezone);
  return day >= start && day <= end;
}

export function eventLocalMorningDigestKey(
  now: Date,
  event: { timezone: string },
): string {
  return localDayKey(now, event.timezone);
}

/** True during the event-local morning digest hour (06:00–10:59). */
export function isEventLocalMorning(now: Date, timezone: string): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value || 0);
  return hour >= 6 && hour < 11;
}
