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

/** W-7 — one old → new pair on an update row, rendered like the config diff card. */
export type ReviewFieldChange = {
  field: string;
  label: string;
  from: string;
  to: string;
};

/** W-7 — an existing session an ambiguous row could be applied to. */
export type MatchCandidateLite = {
  sessionId: string;
  existingTitle: string;
  existingDay?: string;
  existingTime?: string;
  existingRoom?: string;
  tier?: string;
  similarity?: number;
  changes?: ReviewFieldChange[];
  message?: string;
  movesTime?: boolean;
  joinedCount?: number;
  bookmarkCount?: number;
  speakerRemovals?: RemovalEntry[];
  itemRemovals?: RemovalEntry[];
};

/**
 * W-7 — the matcher found more than one plausible reading of a row and
 * refused to guess. Unresolved rows stay adds; the organizer can point one at
 * an existing session instead.
 */
export type MatchDecisionLite = {
  reason?: string;
  message?: string;
  candidates: MatchCandidateLite[];
  contendingRowIndexes?: number[];
};

/** Keys that only belong on an update row — dropped when a decision reverts to "add". */
const UPDATE_ONLY_KEYS = [
  "sessionId",
  "existingTitle",
  "message",
  "similarity",
  "tier",
  "changes",
  "movesTime",
  "joinedCount",
  "bookmarkCount",
  "speakerRemovals",
  "itemRemovals",
];

export function removalKey(kind: RemovalKind): "itemRemovals" | "speakerRemovals" {
  return kind === "item" ? "itemRemovals" : "speakerRemovals";
}

export function changesOf(row: LooseRow): ReviewFieldChange[] {
  const raw = row.changes;
  return Array.isArray(raw) ? (raw as ReviewFieldChange[]) : [];
}

/** Undefined unless the row is an unresolved-or-resolved ambiguous match. */
export function decisionOf(row: LooseRow): MatchDecisionLite | undefined {
  const raw = row.decision;
  if (!raw || typeof raw !== "object") return undefined;
  const candidates = (raw as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return undefined;
  return raw as MatchDecisionLite;
}

/** The existing session an ambiguous row currently points at; null means "add as new". */
export function decisionSelection(row: LooseRow): string | null {
  if (row.kind !== "update") return null;
  return typeof row.sessionId === "string" ? row.sessionId : null;
}

/**
 * W-7 — point an ambiguous row at one of its candidates (or back at "add as
 * new"). Nothing else about the row changes, and nothing applies until
 * confirm: this only rewrites what the confirm payload will say.
 */
export function resolveMatchDecision<T extends LooseRow>(
  rows: T[],
  rowIndex: number,
  sessionId: string | null,
): T[] {
  return rows.map((row) => {
    if (row.rowIndex !== rowIndex) return row;
    const decision = decisionOf(row);
    if (!decision) return row;

    const base: Record<string, unknown> = { ...row };
    for (const key of UPDATE_ONLY_KEYS) delete base[key];

    if (sessionId === null) {
      return { ...base, kind: "create" } as unknown as T;
    }
    const candidate = decision.candidates.find((c) => c.sessionId === sessionId);
    if (!candidate) return row;
    return {
      ...base,
      kind: "update",
      sessionId: candidate.sessionId,
      existingTitle: candidate.existingTitle,
      message: candidate.message || "update fields",
      similarity: candidate.similarity ?? 0,
      tier: candidate.tier,
      changes: candidate.changes || [],
      movesTime: candidate.movesTime === true,
      joinedCount: candidate.joinedCount ?? 0,
      bookmarkCount: candidate.bookmarkCount ?? 0,
      ...(candidate.speakerRemovals ? { speakerRemovals: candidate.speakerRemovals } : {}),
      ...(candidate.itemRemovals ? { itemRemovals: candidate.itemRemovals } : {}),
    } as unknown as T;
  });
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
 * H3 (D1): when a re-import proposes deletes, the organiser first answers
 * whether the file was the full program or part of it. "part" (default)
 * drops delete proposals entirely so they never reach review or confirm.
 */
export type ImportScope = "part" | "full";

export function applyImportScope<T extends { kind?: string }>(rows: T[], scope: ImportScope): T[] {
  return scope === "part" ? rows.filter((r) => r.kind !== "delete") : rows;
}

/**
 * W-6 — the same honesty as Program session deletes: say how many people
 * joined or bookmarked the sessions about to disappear.
 */
export function sessionDeleteBlastCopy(joined: number, bookmarked: number): string {
  if (joined <= 0 && bookmarked <= 0) {
    return "No attendees have joined or bookmarked this session.";
  }
  const bits: string[] = [];
  if (joined > 0) bits.push(`${joined} joined`);
  if (bookmarked > 0) bits.push(`${bookmarked} bookmarked`);
  return `${bits.join(", ")} — their schedules lose this session.`;
}

export function deleteRowsBlastCopy(
  rows: Array<{ accepted?: boolean; joinedCount?: unknown; bookmarkCount?: unknown }>,
): string | null {
  const accepted = rows.filter((r) => r.accepted === true);
  if (accepted.length === 0) return null;
  const joined = accepted.reduce((n, r) => n + (typeof r.joinedCount === "number" ? r.joinedCount : 0), 0);
  const bookmarked = accepted.reduce(
    (n, r) => n + (typeof r.bookmarkCount === "number" ? r.bookmarkCount : 0),
    0,
  );
  const head =
    accepted.length === 1
      ? "Deleting 1 session."
      : `Deleting ${accepted.length} sessions.`;
  return `${head} ${sessionDeleteBlastCopy(joined, bookmarked)}`;
}

/**
 * W-7 — the same honesty as a delete, for a session that keeps existing but
 * lands at a different time: whoever joined it is being rescheduled.
 */
export function sessionMoveBlastCopy(joined: number, bookmarked: number): string {
  if (joined <= 0 && bookmarked <= 0) {
    return "No attendees have joined or bookmarked this session yet.";
  }
  const bits: string[] = [];
  if (joined > 0) bits.push(`${joined} joined`);
  if (bookmarked > 0) bits.push(`${bookmarked} bookmarked`);
  return `${bits.join(", ")} — their schedules move with it.`;
}

export function moveRowsBlastCopy(
  rows: Array<{ accepted?: boolean; movesTime?: unknown; joinedCount?: unknown; bookmarkCount?: unknown }>,
): string | null {
  const moving = rows.filter((r) => r.accepted !== false && r.movesTime === true);
  if (moving.length === 0) return null;
  const joined = moving.reduce((n, r) => n + (typeof r.joinedCount === "number" ? r.joinedCount : 0), 0);
  const bookmarked = moving.reduce(
    (n, r) => n + (typeof r.bookmarkCount === "number" ? r.bookmarkCount : 0),
    0,
  );
  const head = moving.length === 1 ? "Moving 1 session." : `Moving ${moving.length} sessions.`;
  return `${head} ${sessionMoveBlastCopy(joined, bookmarked)}`;
}

/**
 * Rebuild the API changeset from edited review rows, merging each row over
 * its original (so fields the UI does not track survive the round-trip).
 * Removal arrays and W-7 decisions come from the edited row when present —
 * they carry the organiser's ticks and match choice.
 */
export function rowsToApiChangeset(rows: LooseRow[], original: unknown): Record<string, unknown>[] {
  const orig = Array.isArray(original) ? (original as Record<string, unknown>[]) : [];
  return rows.map((row) => {
    const merged: Record<string, unknown> = {
      ...(orig.find((o) => Number(o.rowIndex) === row.rowIndex) || {}),
    };
    for (const [key, value] of Object.entries(row)) {
      // A row the UI does not track a field on must not blank it, but a row
      // that dropped a field on purpose (an ambiguous match reverted to "add")
      // must not have the original's version resurrected either.
      if (value === undefined && key in merged) continue;
      merged[key] = value;
    }
    if (row.kind === "create") {
      for (const key of UPDATE_ONLY_KEYS) delete merged[key];
    }
    return merged;
  });
}
