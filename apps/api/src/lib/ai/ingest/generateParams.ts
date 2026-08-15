/**
 * H-GEN — "describe your event, get a suggested agenda".
 *
 * The organizer fills a structured form (day window, lunch/breaks, rooms,
 * parallel sessions per slot, session length). Those parameters are
 * serialized into a deterministic labeled plain-text block that travels the
 * EXISTING ingest pipeline as the run's source text — the generate-mode
 * prompt drafts a skeleton from it, and the normal extract→changeset→
 * review→confirm flow does the rest.
 */

import { z } from "zod";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const timeSchema = z.string().regex(TIME_RE, "Expected HH:MM (24-hour)");

const windowSchema = z.object({ start: timeSchema, end: timeSchema });

export const agendaGenParamsSchema = z.object({
  dayStart: timeSchema,
  dayEnd: timeSchema,
  lunch: windowSchema.nullish(),
  breaks: z.array(windowSchema).max(4).optional(),
  /** Room names; may be empty when only a count is known. */
  rooms: z.array(z.string().trim().min(1).max(120)).max(40),
  /** Used when `rooms` is empty. */
  roomCount: z.number().int().min(1).max(40).nullish(),
  parallelPerSlot: z.number().int().min(1).max(40),
  sessionMinutes: z.number().int().min(15).max(240),
  gapMinutes: z.number().int().min(0).max(60),
  includeWelcome: z.boolean(),
  /** Informs copy/assumptions only for now (attendees pick one per slot). */
  breakoutStyle: z.boolean(),
  notes: z.string().max(2000).optional(),
});

export type AgendaGenParams = z.infer<typeof agendaGenParamsSchema>;

/** Inclusive YYYY-MM-DD day list between two dates (calendar, not tz-shifted). */
function listDays(startDate: string, endDate: string): string[] {
  const start = Date.parse(`${startDate.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${endDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return [startDate.slice(0, 10)];
  }
  const days: string[] = [];
  // Bound at 31 days: the form is for single conferences, not year planners.
  for (let t = start; t <= end && days.length < 31; t += 86_400_000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

function windowLabel(w: { start: string; end: string }): string {
  return `${w.start}-${w.end}`;
}

/**
 * Serialize form parameters into the labeled "EVENT PARAMETERS" block used as
 * the ingest run's source text. Deterministic: same inputs → same string.
 */
export function paramsToSourceText(
  p: AgendaGenParams,
  event: { name: string; startDate: string; endDate: string; timezone: string },
): string {
  const days = listDays(event.startDate, event.endDate);
  const roomsLine = p.rooms.length
    ? p.rooms.join("; ")
    : p.roomCount
      ? `${p.roomCount} rooms (unnamed — use "Room 1".."Room ${p.roomCount}")`
      : "none specified";
  const lines = [
    "EVENT PARAMETERS",
    `Event: ${event.name}`,
    `Timezone: ${event.timezone}`,
    `Days: ${days.join(", ")}`,
    `Day start: ${p.dayStart}`,
    `Day end: ${p.dayEnd}`,
    `Lunch: ${p.lunch ? windowLabel(p.lunch) : "none"}`,
    `Breaks: ${p.breaks?.length ? p.breaks.map(windowLabel).join("; ") : "none"}`,
    `Rooms: ${roomsLine}`,
    `Parallel sessions per slot: ${p.parallelPerSlot}`,
    `Session length minutes: ${p.sessionMinutes}`,
    `Gap minutes: ${p.gapMinutes}`,
    `Include welcome block: ${p.includeWelcome ? "yes" : "no"}`,
    `Breakout style (attendees pick one session per timeslot): ${p.breakoutStyle ? "yes" : "no"}`,
    `Notes: ${p.notes?.trim() ? p.notes.trim() : "none"}`,
  ];
  return `${lines.join("\n")}\n`;
}
