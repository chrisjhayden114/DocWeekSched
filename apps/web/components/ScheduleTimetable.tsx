/**
 * Grid / By-room timetable views (Chunk D6 / PARITY_AUDIT G1).
 * Read-only layout of sessions already loaded by the agenda pages.
 */

import { useMemo } from "react";
import { trackColor } from "../lib/trackColors";

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
};

const PX_PER_HOUR = 72;
const COL_MIN_WIDTH = 180;
const GUTTER = 8;
/** Breathing room above the first hour label so it is never clipped. */
const TOP_PAD = 14;

function zonedParts(iso: string, timeZone: string) {
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

function dayHeading(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map((n) => Number(n));
  if (!y || !m || !d) return dayKey;
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function longDayHeading(dayKey: string): { weekday: string; rest: string } {
  const [y, m, d] = dayKey.split("-").map((n) => Number(n));
  if (!y || !m || !d) return { weekday: dayKey, rest: "" };
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  return {
    weekday: new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(date),
    rest: new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(date),
  };
}

function minutesFromDayStart(iso: string, timeZone: string, rangeStartHour: number): number {
  const { hour, minute } = zonedParts(iso, timeZone);
  return (hour - rangeStartHour) * 60 + minute;
}

/** Hour span of a session set: earliest start hour → latest end hour (ceil). */
function hourRange(sessions: TimetableSession[], timeZone: string): { startHour: number; endHour: number } {
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

type Placed = {
  session: TimetableSession;
  top: number;
  height: number;
  col: number;
  colCount: number;
};

/** Greedy column packing for concurrent sessions within one vertical strip. */
function placeInColumn(
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

function hourLabels(startHour: number, endHour: number): number[] {
  const labels: number[] = [];
  for (let h = startHour; h <= endHour; h++) labels.push(h);
  return labels;
}

function formatHour(h: number): string {
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${ampm}`;
}

function TimetableBlock({
  placed,
  orderedTrackIds,
  onSelect,
}: {
  placed: Placed;
  orderedTrackIds: string[];
  onSelect?: (id: string) => void;
}) {
  const { session, top, height, col, colCount } = placed;
  const color = trackColor(session.trackId, session.trackExplicitColor, orderedTrackIds);
  const widthPct = 100 / colCount;
  const leftPct = col * widthPct;
  const interactive = Boolean(onSelect);
  return (
    <button
      type="button"
      className="schedule-grid-block"
      style={{
        top,
        height,
        left: `calc(${leftPct}% + ${GUTTER / 2}px)`,
        width: `calc(${widthPct}% - ${GUTTER}px)`,
        ["--track-color" as string]: color,
        cursor: interactive ? "pointer" : "default",
      }}
      onClick={() => onSelect?.(session.id)}
      title={session.title}
      tabIndex={interactive ? 0 : -1}
    >
      <span className="schedule-grid-block-title">{session.title}</span>
      {session.roomLabel ? <span className="schedule-grid-block-room">{session.roomLabel}</span> : null}
    </button>
  );
}

/**
 * One timetable of columns × single time axis. Callers must ensure all
 * sessions fall on the SAME day — a time axis never mixes days.
 */
function TimetableGrid({
  columns,
  sessionsByColumn,
  timeZone,
  startHour,
  endHour,
  orderedTrackIds,
  ariaLabel,
  onSelectSession,
}: {
  columns: { key: string; label: string }[];
  sessionsByColumn: Map<string, TimetableSession[]>;
  timeZone: string;
  startHour: number;
  endHour: number;
  orderedTrackIds: string[];
  ariaLabel: string;
  onSelectSession?: (id: string) => void;
}) {
  const bodyHeight = TOP_PAD + (endHour - startHour) * PX_PER_HOUR + 8;
  const hours = hourLabels(startHour, endHour);
  return (
    <div className="schedule-grid" role="region" aria-label={ariaLabel}>
      <div className="schedule-grid-scroll">
        <div className="schedule-grid-corner" aria-hidden />
        <div
          className="schedule-grid-day-headers"
          style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(${COL_MIN_WIDTH}px, 1fr))` }}
        >
          {columns.map((c) => (
            <div key={c.key} className="schedule-grid-day-header">
              {c.label}
            </div>
          ))}
        </div>
        <div className="schedule-grid-axis" style={{ height: bodyHeight }} aria-hidden>
          {hours.map((h) => (
            <div
              key={h}
              className="schedule-grid-hour-label"
              style={{ top: TOP_PAD + (h - startHour) * PX_PER_HOUR }}
            >
              {formatHour(h)}
            </div>
          ))}
        </div>
        <div
          className="schedule-grid-columns"
          style={{
            gridTemplateColumns: `repeat(${columns.length}, minmax(${COL_MIN_WIDTH}px, 1fr))`,
            height: bodyHeight,
          }}
        >
          {columns.map((c) => {
            const placed = placeInColumn(sessionsByColumn.get(c.key) || [], timeZone, startHour);
            return (
              <div key={c.key} className="schedule-grid-col">
                {hours.map((h) => (
                  <div
                    key={h}
                    className="schedule-grid-hline"
                    style={{ top: TOP_PAD + (h - startHour) * PX_PER_HOUR }}
                    aria-hidden
                  />
                ))}
                {placed.map((p) => (
                  <TimetableBlock
                    key={p.session.id}
                    placed={p}
                    orderedTrackIds={orderedTrackIds}
                    onSelect={onSelectSession}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function groupByDay(sessions: TimetableSession[], timeZone: string): Map<string, TimetableSession[]> {
  const map = new Map<string, TimetableSession[]>();
  for (const s of sessions) {
    const { dayKey } = zonedParts(s.startsAt, timeZone);
    map.set(dayKey, [...(map.get(dayKey) || []), s]);
  }
  return map;
}

export function ScheduleGridView({
  sessions,
  timeZone,
  orderedTrackIds,
  onSelectSession,
}: {
  sessions: TimetableSession[];
  timeZone: string;
  orderedTrackIds: string[];
  onSelectSession?: (id: string) => void;
}) {
  const { columns, byDay, startHour, endHour } = useMemo(() => {
    const byDay = groupByDay(sessions, timeZone);
    const days = [...byDay.keys()].sort();
    const range = sessions.length
      ? hourRange(sessions, timeZone)
      : { startHour: 9, endHour: 17 };
    return {
      columns: days.map((d) => ({ key: d, label: dayHeading(d) })),
      byDay,
      ...range,
    };
  }, [sessions, timeZone]);

  if (sessions.length === 0) {
    return <p className="list-empty text-body-md">No sessions in this view.</p>;
  }

  return (
    <TimetableGrid
      columns={columns}
      sessionsByColumn={byDay}
      timeZone={timeZone}
      startHour={startHour}
      endHour={endHour}
      orderedTrackIds={orderedTrackIds}
      ariaLabel="Grid schedule"
      onSelectSession={onSelectSession}
    />
  );
}

/** Rooms of one day's sessions, alphabetical; "No room" column only if needed. */
function roomColumns(daySessions: TimetableSession[]): {
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

/**
 * By-room view: one grid section PER DAY (own time axis + bold day header),
 * so a single axis never mixes sessions from different days. With a day
 * filter active only that day's section renders.
 */
export function ScheduleByRoomView({
  sessions,
  timeZone,
  orderedTrackIds,
  onSelectSession,
}: {
  sessions: TimetableSession[];
  timeZone: string;
  orderedTrackIds: string[];
  onSelectSession?: (id: string) => void;
}) {
  const days = useMemo(() => {
    const byDay = groupByDay(sessions, timeZone);
    return [...byDay.keys()].sort().map((dayKey) => {
      const daySessions = byDay.get(dayKey)!;
      return {
        dayKey,
        ...roomColumns(daySessions),
        ...hourRange(daySessions, timeZone),
      };
    });
  }, [sessions, timeZone]);

  if (sessions.length === 0) {
    return <p className="list-empty text-body-md">No sessions in this view.</p>;
  }

  return (
    <div className="schedule-byroom-days">
      {days.map(({ dayKey, columns, byRoom, startHour, endHour }) => {
        const { weekday, rest } = longDayHeading(dayKey);
        return (
          <section key={dayKey} className="schedule-byroom-day">
            <h3 className="schedule-day-heading">
              <strong>{weekday}</strong>
              {rest ? `, ${rest}` : null}
            </h3>
            <TimetableGrid
              columns={columns}
              sessionsByColumn={byRoom}
              timeZone={timeZone}
              startHour={startHour}
              endHour={endHour}
              orderedTrackIds={orderedTrackIds}
              ariaLabel={`By room schedule — ${weekday}${rest ? `, ${rest}` : ""}`}
              onSelectSession={onSelectSession}
            />
          </section>
        );
      })}
    </div>
  );
}
