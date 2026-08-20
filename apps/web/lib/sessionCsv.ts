/**
 * CSV session import (non-AI fallback): template, header auto-mapping, and
 * per-row validation. Parsing the file into headers/rows happens in
 * parseCsvToTable (components/ReviewChangeset); everything here is pure so it
 * can be unit-tested without a DOM.
 */

import { isOutsideEventDates, zonedDateTimeLocalToIso } from "./eventTimezone";

export const SESSION_CSV_FIELDS = [
  "title",
  "start",
  "end",
  "track",
  "room",
  "speakers",
  "description",
] as const;

export type SessionCsvField = (typeof SESSION_CSV_FIELDS)[number];

export const SESSION_CSV_MAPPING_OPTIONS: { value: string; label: string }[] = [
  { value: "title", label: "Title" },
  { value: "start", label: "Start (date + time)" },
  { value: "end", label: "End (date + time)" },
  { value: "track", label: "Track name" },
  { value: "room", label: "Room name" },
  { value: "speakers", label: "Speakers" },
  { value: "description", label: "Description" },
  { value: "skip", label: "Skip" },
];

/** Downloadable template: header row plus two illustrative rows. */
export function sessionCsvTemplate(): string {
  return [
    "title,start,end,track,room,speakers,description",
    '"Opening keynote: Designing calm learning days",2026-09-14 09:00,2026-09-14 10:00,Keynote,Hall A,"Jordan Lee","Welcome and the year ahead"',
    '"Workshop block A: Reading conferences",2026-09-14 10:30,2026-09-14 12:00,Workshops,Room 12,"Priya Raman, Sam Whitfield",',
    "",
  ].join("\n");
}

const HEADER_ALIASES: Record<string, SessionCsvField> = {
  title: "title",
  session: "title",
  "session title": "title",
  name: "title",
  start: "start",
  starts: "start",
  "start time": "start",
  begin: "start",
  end: "end",
  ends: "end",
  "end time": "end",
  finish: "end",
  track: "track",
  room: "room",
  location: "room",
  speakers: "speakers",
  speaker: "speakers",
  presenters: "speakers",
  description: "description",
  abstract: "description",
  notes: "description",
};

/** Best-effort header → field mapping; unmatched headers map to "skip". */
export function autoMapSessionCsv(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const taken = new Set<string>();
  for (const h of headers) {
    const field = HEADER_ALIASES[h.trim().toLowerCase()];
    if (field && !taken.has(field)) {
      mapping[h] = field;
      taken.add(field);
    } else {
      mapping[h] = "skip";
    }
  }
  return mapping;
}

/**
 * Accepts "YYYY-MM-DD HH:MM" or "YYYY-MM-DDTHH:MM" (24-hour, wall clock in
 * the event timezone). Returns the normalized datetime-local string, or null.
 */
export function parseCsvDateTime(value: string): string | null {
  const m = value.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
}

export type SessionCsvCreate = {
  kind: "create";
  rowIndex: number;
  title: string;
  /** Day label in the event timezone, e.g. "2026-09-14". */
  day: string;
  timeLabel: string;
  trackName: string | null;
  roomName: string | null;
  /** True when the session falls outside the event's start/end days. */
  outsideEventDates: boolean;
  payload: {
    title: string;
    startsAt: string;
    endsAt: string;
    trackId: string | null;
    roomId: string | null;
    speakers?: string;
    description?: string;
  };
};

export type SessionCsvError = {
  kind: "error";
  /** -1 = applies to the whole file (e.g. a required column is unmapped). */
  rowIndex: number;
  message: string;
};

export type SessionCsvRowResult = SessionCsvCreate | SessionCsvError;

type ValidateInput = {
  rows: Record<string, string>[];
  /** header → field ("skip" to ignore). */
  mapping: Record<string, string>;
  tracks: { id: string; name: string }[];
  rooms: { id: string; name: string }[];
  event: { timezone: string; startDate: string; endDate: string };
};

function fieldValue(row: Record<string, string>, mapping: Record<string, string>, field: SessionCsvField): string {
  for (const [header, mapped] of Object.entries(mapping)) {
    if (mapped === field) return (row[header] ?? "").trim();
  }
  return "";
}

/** Validate mapped CSV rows into create payloads or per-row errors. */
export function validateSessionCsvRows(input: ValidateInput): SessionCsvRowResult[] {
  const mappedFields = new Set(Object.values(input.mapping));
  const missing = (["title", "start", "end"] as const).filter((f) => !mappedFields.has(f));
  if (missing.length > 0) {
    return [
      {
        kind: "error",
        rowIndex: -1,
        message: `Map a column to ${missing.join(", ")} to continue (use the column mapping above).`,
      },
    ];
  }

  const trackByName = new Map(input.tracks.map((t) => [t.name.trim().toLowerCase(), t]));
  const roomByName = new Map(input.rooms.map((r) => [r.name.trim().toLowerCase(), r]));

  return input.rows.map((row, rowIndex): SessionCsvRowResult => {
    const title = fieldValue(row, input.mapping, "title");
    if (!title) return { kind: "error", rowIndex, message: "Missing title." };

    const startRaw = fieldValue(row, input.mapping, "start");
    const endRaw = fieldValue(row, input.mapping, "end");
    const startLocal = parseCsvDateTime(startRaw);
    if (!startLocal) {
      return {
        kind: "error",
        rowIndex,
        message: `Unrecognized start "${startRaw}" — use YYYY-MM-DD HH:MM (24-hour, event timezone).`,
      };
    }
    const endLocal = parseCsvDateTime(endRaw);
    if (!endLocal) {
      return {
        kind: "error",
        rowIndex,
        message: `Unrecognized end "${endRaw}" — use YYYY-MM-DD HH:MM (24-hour, event timezone).`,
      };
    }
    const startsAt = zonedDateTimeLocalToIso(startLocal, input.event.timezone);
    const endsAt = zonedDateTimeLocalToIso(endLocal, input.event.timezone);
    if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      return { kind: "error", rowIndex, message: `End (${endRaw}) must be after start (${startRaw}).` };
    }

    const trackName = fieldValue(row, input.mapping, "track");
    let trackId: string | null = null;
    if (trackName) {
      const track = trackByName.get(trackName.toLowerCase());
      if (!track) {
        return {
          kind: "error",
          rowIndex,
          message: `Track "${trackName}" doesn't exist yet — add it on the Program tab first, or leave the cell blank.`,
        };
      }
      trackId = track.id;
    }

    const roomName = fieldValue(row, input.mapping, "room");
    let roomId: string | null = null;
    if (roomName) {
      const room = roomByName.get(roomName.toLowerCase());
      if (!room) {
        return {
          kind: "error",
          rowIndex,
          message: `Room "${roomName}" doesn't exist yet — add it on the Program tab first, or leave the cell blank.`,
        };
      }
      roomId = room.id;
    }

    const speakers = fieldValue(row, input.mapping, "speakers");
    const description = fieldValue(row, input.mapping, "description");

    return {
      kind: "create",
      rowIndex,
      title,
      day: startLocal.slice(0, 10),
      timeLabel: `${startLocal.slice(11, 16)}–${endLocal.slice(11, 16)}`,
      trackName: trackName || null,
      roomName: roomName || null,
      outsideEventDates: isOutsideEventDates(
        startsAt,
        endsAt,
        input.event.startDate,
        input.event.endDate,
        input.event.timezone,
      ),
      payload: {
        title,
        startsAt,
        endsAt,
        trackId,
        roomId,
        ...(speakers ? { speakers } : {}),
        ...(description ? { description } : {}),
      },
    };
  });
}
