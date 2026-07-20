/**
 * Attendee-local timezone helpers (Intl — no extra deps).
 * Reused by quiet hours, push-day keys, and digest scheduling.
 */

export function parseHm(hm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return 0;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return 0;
  return h * 60 + min;
}

export function formatHm(totalMinutes: number): string {
  const mins = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function getZonedParts(
  date: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Attendee-local calendar day `YYYY-MM-DD`. */
export function localDayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function localMinutesSinceMidnight(date: Date, timeZone: string): number {
  const p = getZonedParts(date, timeZone);
  return p.hour * 60 + p.minute;
}

/**
 * Quiet hours that span midnight (default 22:00–07:00).
 * If start <= end, treated as a same-day window.
 */
export function isInQuietHours(
  date: Date,
  timeZone: string,
  quietStartHm: string,
  quietEndHm: string,
): boolean {
  const mins = localMinutesSinceMidnight(date, timeZone);
  const start = parseHm(quietStartHm);
  const end = parseHm(quietEndHm);
  if (start === end) return false;
  if (start < end) return mins >= start && mins < end;
  return mins >= start || mins < end;
}

/** Convert a wall-clock in `timeZone` to a UTC Date (iterative offset fix). */
export function zonedWallTimeToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
): Date {
  let guess = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 4; i++) {
    const p = getZonedParts(new Date(guess), timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const wanted = Date.UTC(year, month - 1, day, hour, minute, second);
    const delta = wanted - asUtc;
    if (delta === 0) break;
    guess += delta;
  }
  return new Date(guess);
}

function addLocalDays(year: number, month: number, day: number, delta: number) {
  const utc = new Date(Date.UTC(year, month - 1, day + delta));
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() };
}

/**
 * Next instant when quiet hours end (attendee-local quietEndHm).
 * If currently in quiet hours, returns the upcoming end; otherwise null.
 */
export function nextQuietHoursEnd(
  date: Date,
  timeZone: string,
  quietStartHm: string,
  quietEndHm: string,
): Date | null {
  if (!isInQuietHours(date, timeZone, quietStartHm, quietEndHm)) return null;
  const p = getZonedParts(date, timeZone);
  const endMins = parseHm(quietEndHm);
  const endH = Math.floor(endMins / 60);
  const endM = endMins % 60;
  const start = parseHm(quietStartHm);
  const end = parseHm(quietEndHm);
  const mins = p.hour * 60 + p.minute;

  let target = { year: p.year, month: p.month, day: p.day };
  // Overnight window: if we're past start (e.g. 23:00), end is tomorrow morning.
  if (start > end && mins >= start) {
    target = addLocalDays(p.year, p.month, p.day, 1);
  }
  return zonedWallTimeToUtc(timeZone, target.year, target.month, target.day, endH, endM, 0);
}
