/**
 * W-5 — clock times on the setup form (dayStartTime / dayEndTime merged into
 * startDate/endDate as YYYY-MM-DDTHH:mm) become the created event's bounds.
 * A date-only value still defaults to 09:00 / 17:00.
 */

import type { SetupCopilotFormState } from "@event-app/shared";

function parseFormDateTime(value: string, defaultH: number, defaultM: number): Date {
  const ymd = value.slice(0, 10);
  const hm = /^(\d{4}-\d{2}-\d{2})T(\d{1,2}):(\d{2})/.exec(value.trim());
  const h = hm ? Number(hm[2]) : defaultH;
  const m = hm ? Number(hm[3]) : defaultM;
  return new Date(`${ymd}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`);
}

export function eventBoundsFromSetupForm(form: SetupCopilotFormState): { start: Date; end: Date } {
  const start = parseFormDateTime(form.startDate, 9, 0);
  const end = parseFormDateTime(form.endDate, 17, 0);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    const now = new Date();
    const later = new Date(now.getTime() + 2 * 86_400_000);
    return { start: now, end: later };
  }
  return { start, end };
}
