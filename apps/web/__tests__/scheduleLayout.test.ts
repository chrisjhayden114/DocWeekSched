/**
 * E19.1 — concurrent sessions at scale. Tested with FIVE concurrent
 * sessions (see fixtures/concurrentSessions.ts), not two.
 */

import { describe, expect, it } from "vitest";
import {
  COL_MIN_WIDTH,
  GUTTER,
  LANE_MIN_WIDTH,
  columnMinWidth,
  hourRange,
  maxLaneCount,
  placeInColumn,
  roomColumns,
} from "../lib/scheduleLayout";
import {
  FIVE_CONCURRENT_SESSIONS,
  SOLO_SESSION_AFTER,
} from "./fixtures/concurrentSessions";

const TZ = "America/New_York";

describe("E19.1 — five concurrent sessions (Grid view packing)", () => {
  const all = [...FIVE_CONCURRENT_SESSIONS, SOLO_SESSION_AFTER];
  const { startHour } = hourRange(all, TZ);
  const placed = placeInColumn(all, TZ, startHour);

  it("assigns each of the five concurrent sessions its own lane", () => {
    const cluster = placed.filter((p) =>
      FIVE_CONCURRENT_SESSIONS.some((s) => s.id === p.session.id),
    );
    expect(cluster).toHaveLength(5);
    const lanes = cluster.map((p) => p.col).sort((a, b) => a - b);
    expect(lanes).toEqual([0, 1, 2, 3, 4]);
    for (const p of cluster) expect(p.colCount).toBe(5);
  });

  it("keeps the later solo session at full column width", () => {
    const solo = placed.find((p) => p.session.id === SOLO_SESSION_AFTER.id);
    expect(solo?.col).toBe(0);
    expect(solo?.colCount).toBe(1);
  });

  it("widens the column instead of shrinking lanes below the readable minimum", () => {
    const lanes = maxLaneCount(placed);
    expect(lanes).toBe(5);
    const width = columnMinWidth(lanes);
    // Five lanes never share the base column width — each lane keeps its minimum.
    expect(width).toBe(5 * LANE_MIN_WIDTH + 4 * GUTTER);
    expect(width).toBeGreaterThan(COL_MIN_WIDTH);
    expect(width / lanes).toBeGreaterThanOrEqual(LANE_MIN_WIDTH);
  });

  it("keeps single-lane columns at the base minimum width", () => {
    expect(columnMinWidth(1)).toBe(COL_MIN_WIDTH);
    expect(maxLaneCount(placeInColumn([SOLO_SESSION_AFTER], TZ, startHour))).toBe(1);
  });
});

describe("E19.1 — five concurrent sessions (By-room view)", () => {
  it("gives each of the five rooms its own column, in stable order", () => {
    const { columns, byRoom } = roomColumns(FIVE_CONCURRENT_SESSIONS);
    expect(columns).toHaveLength(5);
    expect(columns.map((c) => c.label)).toEqual([
      "Gallery",
      "Hall A",
      "Hall B",
      "Room 108",
      "Room 214",
    ]);
    for (const c of columns) {
      expect(byRoom.get(c.key)).toHaveLength(1);
    }
  });

  it("adds a No-room column only when a session has no room", () => {
    const { columns } = roomColumns([...FIVE_CONCURRENT_SESSIONS, SOLO_SESSION_AFTER]);
    expect(columns[columns.length - 1]?.label).toBe("No room");
    expect(columns).toHaveLength(6);
  });
});
