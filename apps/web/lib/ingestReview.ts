/**
 * Pure helpers for the agenda-ingest review screen (E13.3), kept out of the
 * page component so the removal-toggle and payload logic is unit-testable.
 */

export type RemovalEntry = {
  /** Present on speaker removals. */
  speakerId?: string;
  name?: string;
  /** Present on paper removals. */
  itemId?: string;
  title?: string;
  accepted?: boolean;
};

export type RemovalKind = "item" | "speaker";

type LooseRow = { kind: string; rowIndex: number; [key: string]: unknown };

export function removalKey(kind: RemovalKind): "itemRemovals" | "speakerRemovals" {
  return kind === "item" ? "itemRemovals" : "speakerRemovals";
}

export function removalsOf(row: LooseRow, kind: RemovalKind): RemovalEntry[] {
  const raw = row[removalKey(kind)];
  return Array.isArray(raw) ? (raw as RemovalEntry[]) : [];
}

/** Toggle one removal checkbox on an update row; every other row/entry is untouched. */
export function toggleRemoval<T extends LooseRow>(
  rows: T[],
  rowIndex: number,
  kind: RemovalKind,
  id: string,
  accepted: boolean,
): T[] {
  return rows.map((row) => {
    if (row.rowIndex !== rowIndex || row.kind !== "update") return row;
    const key = removalKey(kind);
    const list = removalsOf(row, kind).map((entry) => {
      const entryId = kind === "item" ? entry.itemId : entry.speakerId;
      return entryId === id ? { ...entry, accepted } : entry;
    });
    return { ...row, [key]: list };
  });
}

/** The session payload a create row carries (subset the review UI reads). */
export type CreateRowSession = {
  title?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  room?: string;
  speakers?: string[];
  [key: string]: unknown;
};

type CreateRowLike = {
  day?: string | null;
  [key: string]: unknown;
};

/** Narrow a review row's untyped `session` payload (rows carry it via an index signature). */
export function createRowSession(row: CreateRowLike): CreateRowSession | undefined {
  const s = row.session;
  return s && typeof s === "object" ? (s as CreateRowSession) : undefined;
}

export type CreateRowGroup<T extends CreateRowLike = CreateRowLike> = {
  key: string;
  day: string | null;
  startTime: string | null;
  rows: T[];
  roomCount: number;
};

/**
 * H2 (D2): group create rows by day + start time so a 60-row import reads as
 * a handful of verifiable timeslots. Rows with neither a day nor a start time
 * fall into a trailing "other" group. Row order within a group is preserved.
 */
export function groupCreateRows<T extends CreateRowLike>(rows: T[]): CreateRowGroup<T>[] {
  const groups = new Map<string, CreateRowGroup<T>>();
  for (const row of rows) {
    const session = createRowSession(row);
    const day = row.day ?? session?.date ?? null;
    const startTime = session?.startTime ?? null;
    const key = day == null && startTime == null ? "other" : `${day ?? ""}|${startTime ?? ""}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, day, startTime, rows: [], roomCount: 0 };
      groups.set(key, group);
    }
    group.rows.push(row);
  }
  for (const group of groups.values()) {
    const rooms = new Set<string>();
    for (const row of group.rows) {
      const room = createRowSession(row)?.room;
      const trimmed = typeof room === "string" ? room.trim() : "";
      if (trimmed) rooms.add(trimmed);
    }
    group.roomCount = rooms.size;
  }
  return [...groups.values()].sort((a, b) => {
    if (a.key === "other") return b.key === "other" ? 0 : 1;
    if (b.key === "other") return -1;
    const byDay = (a.day ?? "").localeCompare(b.day ?? "");
    if (byDay !== 0) return byDay;
    return (a.startTime ?? "").localeCompare(b.startTime ?? "");
  });
}

/**
 * Rebuild the API changeset from edited review rows, merging each row over
 * its original (so fields the UI does not track survive the round-trip).
 * Removal arrays come from the edited row when present — they carry the
 * organiser's tick state.
 */
export function rowsToApiChangeset(rows: LooseRow[], original: unknown): Record<string, unknown>[] {
  const orig = Array.isArray(original) ? (original as Record<string, unknown>[]) : [];
  return rows.map((row) => {
    const base = orig.find((o) => Number(o.rowIndex) === row.rowIndex) || {};
    return {
      ...base,
      kind: row.kind,
      rowIndex: row.rowIndex,
      accepted: "accepted" in row ? row.accepted : undefined,
      title: "title" in row ? row.title : undefined,
      message: "message" in row ? row.message : undefined,
      session: "session" in row ? row.session : base.session,
      sessionId: "sessionId" in row ? row.sessionId : base.sessionId,
      existingTitle: base.existingTitle,
      speakerRemovals: "speakerRemovals" in row ? row.speakerRemovals : base.speakerRemovals,
      itemRemovals: "itemRemovals" in row ? row.itemRemovals : base.itemRemovals,
    };
  });
}
