/**
 * Convert between UTC instants and wall-clock values in a specific IANA
 * timezone, for organizer forms that edit times "in the event's timezone"
 * via <input type="datetime-local">.
 */

export function zonedDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value || "00";
  return {
    year: Number(read("year")),
    month: Number(read("month")),
    day: Number(read("day")),
    hour: Number(read("hour")) % 24,
    minute: Number(read("minute")),
  };
}

function wallMinutes(parts: { year: number; month: number; day: number; hour: number; minute: number }) {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) / 60000);
}

/** ISO instant → "YYYY-MM-DDTHH:mm" as seen on the wall clock in timeZone. */
export function toLocalInputValueInTimeZone(dateString: string, timeZone: string): string {
  const parts = zonedDateParts(new Date(dateString), timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** "YYYY-MM-DDTHH:mm" wall clock in timeZone → ISO instant. */
export function zonedDateTimeLocalToIso(localValue: string, timeZone: string): string {
  const [datePart, timePart] = localValue.split("T");
  if (!datePart || !timePart) return new Date(localValue).toISOString();
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  const desired = { year, month, day, hour, minute };

  // Start with the wall time as-if it were UTC, then correct until the
  // requested zone's wall clock matches (handles DST offsets).
  let guessUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  for (let i = 0; i < 3; i += 1) {
    const actual = zonedDateParts(new Date(guessUtcMs), timeZone);
    const deltaMinutes = wallMinutes(desired) - wallMinutes(actual);
    if (deltaMinutes === 0) break;
    guessUtcMs += deltaMinutes * 60_000;
  }
  return new Date(guessUtcMs).toISOString();
}

/** Calendar-day key ("2026-07-20") for an instant in timeZone. */
export function zonedDayKey(iso: string | Date, timeZone: string): string {
  const parts = zonedDateParts(typeof iso === "string" ? new Date(iso) : iso, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/**
 * True when a session's start or end falls on a calendar day outside the
 * event's start/end days (compared in the event timezone). Day-level on
 * purpose: an 8 AM session on a 9 AM event start day is fine; a mistyped
 * year or month is not.
 */
export function isOutsideEventDates(
  sessionStartIso: string,
  sessionEndIso: string,
  eventStartIso: string,
  eventEndIso: string,
  timeZone: string,
): boolean {
  try {
    const sessionStart = zonedDayKey(sessionStartIso, timeZone);
    const sessionEnd = zonedDayKey(sessionEndIso, timeZone);
    const eventStart = zonedDayKey(eventStartIso, timeZone);
    const eventEnd = zonedDayKey(eventEndIso, timeZone);
    return sessionStart < eventStart || sessionEnd > eventEnd;
  } catch {
    return false;
  }
}
