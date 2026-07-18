import { localDayKey } from "../../notifications/timezone";
import type { AgendaExtract, ExtractedSession } from "./schema";
import { REIMPORT_TITLE_THRESHOLD, titleSimilarity } from "./similarity";

export type ExistingSessionLite = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  location?: string | null;
  trackName?: string | null;
  roomName?: string | null;
};

export type ChangesetRow =
  | {
      kind: "create";
      rowIndex: number;
      session: ExtractedSession;
      accepted: boolean;
    }
  | {
      kind: "update";
      rowIndex: number;
      sessionId: string;
      session: ExtractedSession;
      existingTitle: string;
      message: string;
      similarity: number;
      accepted: boolean;
    }
  | {
      kind: "delete";
      rowIndex: number;
      sessionId: string;
      existingTitle: string;
      message: string;
      /** Deletes default unchecked. */
      accepted: boolean;
    };

/**
 * Diff extracted sessions against existing event sessions.
 * Match: title similarity ≥ 0.85 + same local calendar day.
 */
export function buildReimportChangeset(
  extract: AgendaExtract,
  existing: ExistingSessionLite[],
  eventTimezone: string,
): ChangesetRow[] {
  const rows: ChangesetRow[] = [];
  const matchedExisting = new Set<string>();
  let rowIndex = 0;

  for (const session of extract.sessions) {
    let best: { ex: ExistingSessionLite; sim: number } | null = null;
    for (const ex of existing) {
      if (matchedExisting.has(ex.id)) continue;
      const day = localDayKey(ex.startsAt, eventTimezone);
      if (day !== session.date) continue;
      const sim = titleSimilarity(session.title, ex.title);
      if (sim < REIMPORT_TITLE_THRESHOLD) continue;
      if (!best || sim > best.sim) best = { ex, sim };
    }

    if (best) {
      matchedExisting.add(best.ex.id);
      const changes: string[] = [];
      if (normalizeClock(best.ex.startsAt, eventTimezone) !== normalizeTimeStr(session.startTime)) {
        changes.push("retime start");
      }
      if (session.room && session.room !== (best.ex.roomName || best.ex.location || "")) {
        changes.push("move room");
      }
      if (session.track && session.track !== (best.ex.trackName || "")) {
        changes.push("move track");
      }
      if (titleSimilarity(session.title, best.ex.title) < 1) {
        changes.push("update title");
      }
      rows.push({
        kind: "update",
        rowIndex: rowIndex++,
        sessionId: best.ex.id,
        session,
        existingTitle: best.ex.title,
        message: changes.length ? changes.join(", ") : "update fields",
        similarity: best.sim,
        accepted: true,
      });
    } else {
      rows.push({
        kind: "create",
        rowIndex: rowIndex++,
        session,
        accepted: true,
      });
    }
  }

  for (const ex of existing) {
    if (matchedExisting.has(ex.id)) continue;
    rows.push({
      kind: "delete",
      rowIndex: rowIndex++,
      sessionId: ex.id,
      existingTitle: ex.title,
      message: "Not found in new import — propose delete",
      accepted: false,
    });
  }

  return rows;
}

function normalizeTimeStr(t: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  if (!m) return t.trim();
  return `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`;
}

function normalizeClock(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const h = parts.find((p) => p.type === "hour")?.value || "00";
  const m = parts.find((p) => p.type === "minute")?.value || "00";
  return `${h}:${m}`;
}

/** Convert a first-import extract into create-only changeset rows. */
export function extractToCreateChangeset(extract: AgendaExtract): ChangesetRow[] {
  return extract.sessions.map((session, rowIndex) => ({
    kind: "create" as const,
    rowIndex,
    session,
    accepted: true,
  }));
}
