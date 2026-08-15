/**
 * Pure layout helpers for the Grid / By-room timetable views (Chunk E19.1).
 *
 * Extracted from components/ScheduleTimetable.tsx so the concurrent-session
 * packing can be unit-tested with realistic fixtures (five parallel tracks,
 * not two). The component imports everything from here.
 */

export type TimetableSession = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  roomKey: string | null;
  roomLabel: string | null;
  trackId: string | null;
  trackName: string | null;
  trackExplicitColor?: string | null;
  /**
   * H4 — personal state markers. Only surfaces with a signed-in viewer
   * (dashboard) populate these; the public page leaves them undefined,
   * which renders no markers at all.
   */
  joined?: boolean;
  starred?: boolean;
};

export const PX_PER_HOUR = 72;
/** Minimum width of one timetable column (a day, or a room). */
export const COL_MIN_WIDTH = 180;
/**
 * Minimum width of ONE concurrency lane inside a column (E19.1): with five
 * concurrent sessions a column must grow instead of slicing itself into
 * unreadable slivers. The grid wrapper scrolls horizontally when the sum of
 * column minimums exceeds the viewport.
 */
export const LANE_MIN_WIDTH = 132;
export const GUTTER = 8;
/** Breathing room above the first hour label so it is never clipped. */
export const TOP_PAD = 14;

export function zonedParts(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "0";
  return {
    dayKey: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

export function minutesFromDayStart(iso: string, timeZone: string, rangeStartHour: number): number {
  const { hour, minute } = zonedParts(iso, timeZone);
  return (hour - rangeStartHour) * 60 + minute;
}

/** Hour span of a session set: earliest start hour → latest end hour (ceil). */
export function hourRange(
  sessions: TimetableSession[],
  timeZone: string,
): { startHour: number; endHour: number } {
  let minH = 23;
  let maxH = 0;
  for (const s of sessions) {
    const start = zonedParts(s.startsAt, timeZone);
    const end = zonedParts(s.endsAt, timeZone);
    minH = Math.min(minH, start.hour);
    maxH = Math.max(maxH, end.minute > 0 ? end.hour + 1 : end.hour);
  }
  const startHour = Math.max(0, minH);
  return { startHour, endHour: Math.min(23, Math.max(startHour + 1, maxH)) };
}

export type Placed = {
  session: TimetableSession;
  top: number;
  height: number;
  col: number;
  colCount: number;
};

/** Greedy column packing for concurrent sessions within one vertical strip. */
export function placeInColumn(
  sessions: TimetableSession[],
  timeZone: string,
  rangeStartHour: number,
): Placed[] {
  const sorted = [...sessions].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );
  type Active = { end: number; col: number };
  const active: Active[] = [];
  const out: Placed[] = [];
  const ranges: { start: number; end: number }[] = [];

  for (const session of sorted) {
    const startMs = new Date(session.startsAt).getTime();
    const endMs = new Date(session.endsAt).getTime();
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i]!.end <= startMs) active.splice(i, 1);
    }
    const used = new Set(active.map((a) => a.col));
    let col = 0;
    while (used.has(col)) col += 1;
    active.push({ end: endMs, col });
    const startMin = minutesFromDayStart(session.startsAt, timeZone, rangeStartHour);
    const endMin = minutesFromDayStart(session.endsAt, timeZone, rangeStartHour);
    const height = Math.max(28, ((endMin - startMin) / 60) * PX_PER_HOUR - 2);
    ranges.push({ start: startMs, end: endMs });
    out.push({
      session,
      top: TOP_PAD + (startMin / 60) * PX_PER_HOUR,
      height,
      col,
      colCount: 1,
    });
  }

  /* Per-cluster colCount so solo sessions keep full column width. */
  return out.map((p, i) => {
    const { start, end } = ranges[i]!;
    let maxCol = p.col;
    for (let j = 0; j < out.length; j++) {
      const r = ranges[j]!;
      if (r.start < end && r.end > start) {
        maxCol = Math.max(maxCol, out[j]!.col);
      }
    }
    return { ...p, colCount: maxCol + 1 };
  });
}

/** Widest concurrency cluster in a set of placed sessions (1 when nothing overlaps). */
export function maxLaneCount(placed: Placed[]): number {
  let lanes = 1;
  for (const p of placed) lanes = Math.max(lanes, p.colCount);
  return lanes;
}

/**
 * Minimum px width for one timetable column given its widest concurrency
 * cluster: never narrower than COL_MIN_WIDTH, and never so narrow that a
 * lane drops below LANE_MIN_WIDTH (E19.1 — five concurrent sessions must
 * widen the column, not shrink the cards).
 */
export function columnMinWidth(laneCount: number): number {
  const lanes = Math.max(1, laneCount);
  return Math.max(COL_MIN_WIDTH, lanes * LANE_MIN_WIDTH + (lanes - 1) * GUTTER);
}

/** Rooms of one day's sessions, alphabetical; "No room" column only if needed. */
export function roomColumns(daySessions: TimetableSession[]): {
  columns: { key: string; label: string }[];
  byRoom: Map<string, TimetableSession[]>;
} {
  const byRoom = new Map<string, TimetableSession[]>();
  let hasNoRoom = false;
  for (const s of daySessions) {
    const key = s.roomKey?.trim() || "__none__";
    if (key === "__none__") hasNoRoom = true;
    byRoom.set(key, [...(byRoom.get(key) || []), s]);
  }
  const named = [...byRoom.keys()]
    .filter((k) => k !== "__none__")
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map((key) => ({ key, label: byRoom.get(key)?.[0]?.roomLabel || key }));
  return {
    columns: hasNoRoom ? [...named, { key: "__none__", label: "No room" }] : named,
    byRoom,
  };
}

export function groupByDay(
  sessions: TimetableSession[],
  timeZone: string,
): Map<string, TimetableSession[]> {
  const map = new Map<string, TimetableSession[]>();
  for (const s of sessions) {
    const { dayKey } = zonedParts(s.startsAt, timeZone);
    map.set(dayKey, [...(map.get(dayKey) || []), s]);
  }
  return map;
}
