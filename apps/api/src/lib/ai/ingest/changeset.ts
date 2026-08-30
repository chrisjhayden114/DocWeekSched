import { localDayKey } from "../../notifications/timezone";
import type { AgendaExtract, ExtractedSession } from "./schema";
import { normalizeTitle } from "./schema";
import { REIMPORT_TITLE_THRESHOLD, titleSimilarity } from "./similarity";

/** E13.3: existing children of a matched session, so a re-import can PROPOSE removals instead of forcing them. */
export type ExistingSpeakerLite = { speakerId: string; name: string };
export type ExistingItemLite = { itemId: string; title: string };

export type ExistingSessionLite = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  location?: string | null;
  trackName?: string | null;
  roomName?: string | null;
  speakers?: ExistingSpeakerLite[];
  items?: ExistingItemLite[];
  /** W-6 — attendee blast radius for a proposed delete. */
  joinedCount?: number;
  bookmarkCount?: number;
};

/** E13.3: a child the source no longer mentions. Removal defaults unchecked — nothing hand-entered disappears without a tick. */
export type SpeakerRemoval = { speakerId: string; name: string; accepted: boolean };
export type ItemRemoval = { itemId: string; title: string; accepted: boolean };

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
      /** Existing speakers not in this import (unchecked by default). */
      speakerRemovals?: SpeakerRemoval[];
      /** Existing papers not in this import (unchecked by default). */
      itemRemovals?: ItemRemoval[];
    }
  | {
      kind: "delete";
      rowIndex: number;
      sessionId: string;
      existingTitle: string;
      message: string;
      /** Deletes default unchecked. */
      accepted: boolean;
      /** W-6 — joined / bookmarked counts for the confirm copy. */
      joinedCount?: number;
      bookmarkCount?: number;
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
  // E9.2: an empty extract means the parse failed — never propose deleting
  // the existing programme on the strength of it.
  if (extract.sessions.length === 0) return [];

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
      // E13.3: children the source does not mention become explicit,
      // unchecked-by-default removal proposals — confirm never deletes them
      // on its own.
      const extractedSpeakerKeys = new Set(session.speakers.map((n) => normalizeTitle(n)));
      const speakerRemovals: SpeakerRemoval[] = (best.ex.speakers || [])
        .filter((sp) => !extractedSpeakerKeys.has(normalizeTitle(sp.name)))
        .map((sp) => ({ speakerId: sp.speakerId, name: sp.name, accepted: false }));
      const extractedItemKeys = new Set((session.items || []).map((it) => normalizeTitle(it.title)));
      const itemRemovals: ItemRemoval[] = (best.ex.items || [])
        .filter((it) => !extractedItemKeys.has(normalizeTitle(it.title)))
        .map((it) => ({ itemId: it.itemId, title: it.title, accepted: false }));
      rows.push({
        kind: "update",
        rowIndex: rowIndex++,
        sessionId: best.ex.id,
        session,
        existingTitle: best.ex.title,
        message: changes.length ? changes.join(", ") : "update fields",
        similarity: best.sim,
        accepted: true,
        ...(speakerRemovals.length ? { speakerRemovals } : {}),
        ...(itemRemovals.length ? { itemRemovals } : {}),
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
      joinedCount: ex.joinedCount ?? 0,
      bookmarkCount: ex.bookmarkCount ?? 0,
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
