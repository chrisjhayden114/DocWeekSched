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
