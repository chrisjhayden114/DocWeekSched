/**
 * Grid / By-room timetable views (Chunk D6 / PARITY_AUDIT G1).
 * Read-only layout of sessions already loaded by the agenda pages.
 *
 * Packing math lives in lib/scheduleLayout.ts (E19.1) so concurrency
 * behaviour is unit-tested with five parallel sessions, not two.
 */

import { useMemo } from "react";
import { trackColor } from "../lib/trackColors";
import {
  GUTTER,
  PX_PER_HOUR,
  TOP_PAD,
  columnMinWidth,
  groupByDay,
  hourRange,
  maxLaneCount,
  placeInColumn,
  roomColumns,
  type Placed,
  type TimetableSession,
} from "../lib/scheduleLayout";

export type { TimetableSession };

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
  untrackedTint,
  onSelect,
}: {
  placed: Placed;
  orderedTrackIds: string[];
  untrackedTint?: string | null;
  onSelect?: (id: string) => void;
}) {
  const { session, top, height, col, colCount } = placed;
  const color = trackColor(session.trackId, session.trackExplicitColor, orderedTrackIds, untrackedTint);
  const widthPct = 100 / colCount;
  const leftPct = col * widthPct;
  const interactive = Boolean(onSelect);
  const style = {
    top,
    height,
    left: `calc(${leftPct}% + ${GUTTER / 2}px)`,
    width: `calc(${widthPct}% - ${GUTTER}px)`,
    ["--track-color" as string]: color,
  };
  // H4 — quiet state markers, top-right: state only, never controls.
  // The public page threads no joined/starred, so nothing renders there.
  const marked = Boolean(session.joined || session.starred);
  const content = (
    <>
      {marked ? (
        <span className="schedule-grid-block-markers">
          {session.joined ? (
            <span className="schedule-grid-block-marker--joined" role="img" aria-label="On your schedule">
              ✓
            </span>
          ) : null}
          {session.starred ? (
            <span className="schedule-grid-block-marker--starred" role="img" aria-label="Starred">
              ★
            </span>
          ) : null}
        </span>
      ) : null}
      <span className="schedule-grid-block-title">{session.title}</span>
      {session.roomLabel ? <span className="schedule-grid-block-room">{session.roomLabel}</span> : null}
    </>
  );
  const blockClass = `schedule-grid-block${marked ? " schedule-grid-block--marked" : ""}`;
  // Where a block cannot be opened (public page), never announce a control:
  // no button role, no pointer cursor, no focus stop.
  if (!interactive) {
    return (
      <div className={`${blockClass} schedule-grid-block--static`} style={style} title={session.title}>
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={blockClass}
      style={style}
      onClick={() => onSelect?.(session.id)}
      title={session.title}
    >
      {content}
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
  untrackedTint,
  ariaLabel,
  onSelectSession,
}: {
  columns: { key: string; label: string }[];
  sessionsByColumn: Map<string, TimetableSession[]>;
  timeZone: string;
  startHour: number;
  endHour: number;
  orderedTrackIds: string[];
  untrackedTint?: string | null;
  ariaLabel: string;
  onSelectSession?: (id: string) => void;
}) {
  const bodyHeight = TOP_PAD + (endHour - startHour) * PX_PER_HOUR + 8;
  const hours = hourLabels(startHour, endHour);
  // Pack every column once, then size each column to its widest concurrency
  // cluster (E19.1): five concurrent sessions widen the column (and the grid
  // scrolls horizontally) instead of shrinking every card to a sliver.
  const packed = columns.map((c) =>
    placeInColumn(sessionsByColumn.get(c.key) || [], timeZone, startHour),
  );
  const gridTemplateColumns = packed
    .map((placed) => `minmax(${columnMinWidth(maxLaneCount(placed))}px, 1fr)`)
    .join(" ");
  return (
    <div className="schedule-grid" role="region" aria-label={ariaLabel}>
      <div className="schedule-grid-scroll">
        <div className="schedule-grid-corner" aria-hidden />
        <div className="schedule-grid-day-headers" style={{ gridTemplateColumns }}>
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
          style={{ gridTemplateColumns, height: bodyHeight }}
        >
          {columns.map((c, colIdx) => {
            const placed = packed[colIdx]!;
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
                    untrackedTint={untrackedTint}
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

export function ScheduleGridView({
  sessions,
  timeZone,
  orderedTrackIds,
  untrackedTint,
  onSelectSession,
}: {
  sessions: TimetableSession[];
  timeZone: string;
  orderedTrackIds: string[];
  untrackedTint?: string | null;
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
      untrackedTint={untrackedTint}
      ariaLabel="Grid schedule"
      onSelectSession={onSelectSession}
    />
  );
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
  untrackedTint,
  onSelectSession,
}: {
  sessions: TimetableSession[];
  timeZone: string;
  orderedTrackIds: string[];
  untrackedTint?: string | null;
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
              untrackedTint={untrackedTint}
              ariaLabel={`By room schedule — ${weekday}${rest ? `, ${rest}` : ""}`}
              onSelectSession={onSelectSession}
            />
          </section>
        );
      })}
    </div>
  );
}
