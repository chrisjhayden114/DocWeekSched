import { localDayKey } from "../../notifications/timezone";
import type { AgendaExtract, ExtractedSession } from "./schema";
import { normalizeTime, normalizeTitle } from "./schema";
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
  /**
   * W-7 — omit only if the caller cannot supply it. A description the diff
   * cannot see is assumed changed rather than assumed equal.
   */
  description?: string | null;
  speakers?: ExistingSpeakerLite[];
  items?: ExistingItemLite[];
  /** W-6 — attendee blast radius for a proposed delete. */
  joinedCount?: number;
  bookmarkCount?: number;
};

/** E13.3: a child the source no longer mentions. Removal defaults unchecked — nothing hand-entered disappears without a tick. */
export type SpeakerRemoval = { speakerId: string; name: string; accepted: boolean };
export type ItemRemoval = { itemId: string; title: string; accepted: boolean };

/**
 * W-7 — which tier matched an extracted session to an existing one:
 * "exact" same title same day, "moved" same title different day,
 * "retitled" similar title on the same day or in the same time slot.
 */
export type MatchTier = "exact" | "moved" | "retitled";

const TIER_ORDER: MatchTier[] = ["exact", "moved", "retitled"];

export type ChangedField = "day" | "time" | "room" | "track" | "title" | "description";

/** W-7 — one old → new pair for the review UI's diff presentation. */
export type FieldChange = {
  field: ChangedField;
  label: string;
  from: string;
  to: string;
};

/** W-7 — an existing session a decision row could be applied to instead of adding. */
export type MatchCandidate = {
  sessionId: string;
  existingTitle: string;
  /** Local calendar day + clock range of the existing session, for the picker label. */
  existingDay: string;
  existingTime: string;
  existingRoom?: string;
  tier: MatchTier;
  similarity: number;
  changes: FieldChange[];
  message: string;
  movesTime: boolean;
  joinedCount: number;
  bookmarkCount: number;
  speakerRemovals?: SpeakerRemoval[];
  itemRemovals?: ItemRemoval[];
};

/**
 * W-7 — one extracted session plausibly matches more than one existing
 * session, or more than one extracted session plausibly matches the same
 * existing one. The matcher refuses to guess: the row stays an ADD (the safe
 * default) and carries the candidates for the organizer to decide.
 */
export type MatchDecision = {
  reason: "multiple-existing" | "multiple-imported";
  message: string;
  candidates: MatchCandidate[];
  /** For "multiple-imported": the other import rows claiming the same session. */
  contendingRowIndexes?: number[];
};

export type ChangesetRow =
  | {
      kind: "create";
      rowIndex: number;
      session: ExtractedSession;
      accepted: boolean;
      /** W-7 — present only on ambiguous rows; unresolved means "add". */
      decision?: MatchDecision;
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
      /** W-7 — which tier matched, and the old → new pairs behind `message`. */
      tier?: MatchTier;
      changes?: FieldChange[];
      /** W-7 — true when the day or the clock time changes. */
      movesTime?: boolean;
      /** W-7 — attendee blast radius, shown when the session moves. */
      joinedCount?: number;
      bookmarkCount?: number;
      /** W-7 — set by the review UI when the organizer resolves an ambiguous row. */
      decision?: MatchDecision;
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

const CHANGE_VERB: Record<ChangedField, string> = {
  day: "moved day",
  time: "retimed",
  room: "moved room",
  track: "moved track",
  title: "retitled",
  description: "new description",
};

/** What the matcher worked out about one extracted ↔ existing pair. */
type MatchDescription = {
  changes: FieldChange[];
  message: string;
  movesTime: boolean;
  speakerRemovals: SpeakerRemoval[];
  itemRemovals: ItemRemoval[];
  /** True when confirm would write something. False means "emit no row". */
  changesAnything: boolean;
  /** The existing session's own day and clock range, for candidate labels. */
  existingDay: string;
  existingTime: string;
};

type Candidate = {
  ex: ExistingSessionLite;
  tier: MatchTier;
  sim: number;
  sameRoom: boolean;
  /** Minutes between the two start clocks. */
  timeDistance: number;
  /** Whole days between the two calendar days. */
  dayDistance: number;
  description: MatchDescription;
};

/**
 * Diff extracted sessions against existing event sessions.
 *
 * W-7: matching runs in tiers so a revised upload UPDATES the session it
 * describes instead of adding a duplicate beside it —
 *   1. same normalized title on the same day,
 *   2. same normalized title on any day (the session moved),
 *   3. title similarity ≥ REIMPORT_TITLE_THRESHOLD on the same day or in the
 *      same time slot (the session was retitled).
 * Within a tier, candidates rank by title similarity, then same room, then
 * clock distance, then day distance. When the top two candidates are
 * indistinguishable on all four — or two extracted sessions fit one existing
 * session equally well — nothing is guessed: the row becomes an ADD carrying
 * a decision for the organizer, and the contested existing sessions are held
 * back from delete proposals.
 */
export function buildReimportChangeset(
  extract: AgendaExtract,
  existing: ExistingSessionLite[],
  eventTimezone: string,
): ChangesetRow[] {
  // E9.2: an empty extract means the parse failed — never propose deleting
  // the existing programme on the strength of it.
  if (extract.sessions.length === 0) return [];

  const sessions = extract.sessions;
  const indices = sessions.map((_, i) => i);
  const available = new Map(existing.map((ex) => [ex.id, ex]));
  const assigned = new Map<number, Candidate>();
  /** Extract index → decision, with contenders still keyed by extract index. */
  const decided = new Map<number, { decision: MatchDecision; contenders: number[] }>();

  for (const tier of TIER_ORDER) {
    // Losing a contest can free a second-choice match, so each tier runs
    // until a pass settles nothing new.
    for (let pass = 0; pass <= sessions.length; pass += 1) {
      const pending = indices.filter((i) => !assigned.has(i) && !decided.has(i));
      if (pending.length === 0) break;

      const ranked = new Map<number, Candidate[]>();
      for (const idx of pending) {
        const candidates = [...available.values()]
          .map((ex) => buildCandidate(sessions[idx], ex, tier, eventTimezone))
          .filter((c): c is Candidate => c !== null)
          .sort(compareCandidates);
        if (candidates.length > 0) ranked.set(idx, candidates);
      }
      if (ranked.size === 0) break;

      const best = (idx: number) => ranked.get(idx)![0];
      const tiedAtTop = (candidates: Candidate[]) =>
        candidates.length > 1 && compareCandidates(candidates[0], candidates[1]) === 0;

      // Rows whose own first choice is a clear leader. A row torn between two
      // existing sessions claims nothing yet — otherwise it could take a
      // session that another row unambiguously owns.
      const claims = new Map<string, number[]>();
      for (const [idx, candidates] of ranked) {
        if (tiedAtTop(candidates)) continue;
        const id = candidates[0].ex.id;
        claims.set(id, [...(claims.get(id) || []), idx]);
      }

      let assignedAny = false;
      for (const [existingId, claimants] of claims) {
        const ordered = [...claimants].sort((a, b) => compareCandidates(best(a), best(b)));
        // A tie between claimants is a decision, handled below — not a guess.
        if (ordered.length > 1 && compareCandidates(best(ordered[0]), best(ordered[1])) === 0) continue;
        assigned.set(ordered[0], best(ordered[0]));
        available.delete(existingId);
        assignedAny = true;
      }
      // Losing a claim can free a second choice, so re-rank after every
      // settled pass before concluding that anything is ambiguous.
      if (assignedAny) continue;

      // Nothing left can be settled without guessing. Surface ONE ambiguity
      // and re-rank: holding sessions back changes what other rows can claim.
      const torn = [...ranked].find(([, candidates]) => tiedAtTop(candidates));
      if (torn) {
        const [idx, candidates] = torn;
        const tied = candidates.filter((c) => compareCandidates(candidates[0], c) === 0);
        decided.set(idx, {
          decision: {
            reason: "multiple-existing",
            message: `Matches ${tied.length} existing sessions equally well — pick one, or add it as new.`,
            candidates: tied.map(toMatchCandidate),
          },
          contenders: [],
        });
        // Held back, so they are neither updated nor proposed for delete.
        for (const c of tied) available.delete(c.ex.id);
        continue;
      }

      // Every remaining claim group is a tie between import rows.
      const contested = [...claims].find(([, claimants]) => claimants.length > 1);
      if (!contested) break;
      const [contestedId, claimants] = contested;
      const ordered = [...claimants].sort((a, b) => compareCandidates(best(a), best(b)));
      const tied = ordered.filter((idx) => compareCandidates(best(ordered[0]), best(idx)) === 0);
      for (const idx of tied) {
        decided.set(idx, {
          decision: {
            reason: "multiple-imported",
            message:
              "Another row in this import matches this existing session equally well — pick one, or add it as new.",
            candidates: [toMatchCandidate(best(idx))],
          },
          contenders: tied.filter((other) => other !== idx),
        });
      }
      available.delete(contestedId);
    }
  }

  // A matched session that changes nothing produces no row at all — but it is
  // still matched, so it is never proposed for deletion either.
  const rows: ChangesetRow[] = [];
  const rowIndexByExtractIndex = new Map<number, number>();
  const emitted: { index: number; match?: Candidate; decision?: MatchDecision }[] = [];

  for (const index of indices) {
    const match = assigned.get(index);
    if (match) {
      if (!match.description.changesAnything) continue;
      emitted.push({ index, match });
      continue;
    }
    emitted.push({ index, decision: decided.get(index)?.decision });
  }

  emitted.forEach((entry, rowIndex) => rowIndexByExtractIndex.set(entry.index, rowIndex));

  for (const entry of emitted) {
    const rowIndex = rowIndexByExtractIndex.get(entry.index)!;
    const session = sessions[entry.index];
    if (entry.match) {
      const { ex, description } = entry.match;
      rows.push({
        kind: "update",
        rowIndex,
        sessionId: ex.id,
        session,
        existingTitle: ex.title,
        message: description.message,
        similarity: entry.match.sim,
        tier: entry.match.tier,
        changes: description.changes,
        movesTime: description.movesTime,
        joinedCount: ex.joinedCount ?? 0,
        bookmarkCount: ex.bookmarkCount ?? 0,
        accepted: true,
        ...(description.speakerRemovals.length
          ? { speakerRemovals: description.speakerRemovals }
          : {}),
        ...(description.itemRemovals.length ? { itemRemovals: description.itemRemovals } : {}),
      });
      continue;
    }
    const contenders = decided.get(entry.index)?.contenders || [];
    rows.push({
      kind: "create",
      rowIndex,
      session,
      accepted: true,
      ...(entry.decision
        ? {
            decision: {
              ...entry.decision,
              ...(contenders.length
                ? {
                    contendingRowIndexes: contenders
                      .map((i) => rowIndexByExtractIndex.get(i))
                      .filter((i): i is number => i != null),
                  }
                : {}),
            },
          }
        : {}),
    });
  }

  // Only sessions still available are unaccounted for. Matched ones and the
  // ones held by a decision row were removed above: an ambiguous session is
  // neither updated nor deleted on a guess.
  let nextRowIndex = rows.length;
  for (const ex of existing) {
    if (!available.has(ex.id)) continue;
    rows.push({
      kind: "delete",
      rowIndex: nextRowIndex++,
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

/** Null when this pair does not qualify for the tier. */
function buildCandidate(
  session: ExtractedSession,
  ex: ExistingSessionLite,
  tier: MatchTier,
  timezone: string,
): Candidate | null {
  const sim = titleSimilarity(session.title, ex.title);
  const sameTitle = normalizeTitle(session.title) === normalizeTitle(ex.title);
  const existingDay = localDayKey(ex.startsAt, timezone);
  const existingStart = normalizeClock(ex.startsAt, timezone);
  const extractStart = normalizeTime(session.startTime);
  const sameDay = existingDay === session.date;
  const sameTime = existingStart === extractStart;

  const qualifies =
    tier === "exact"
      ? sameTitle && sameDay
      : tier === "moved"
        ? sameTitle
        : sim >= REIMPORT_TITLE_THRESHOLD && (sameDay || sameTime);
  if (!qualifies) return null;

  return {
    ex,
    tier,
    sim,
    sameRoom: sameRoomName(session, ex),
    timeDistance: Math.abs(minutesOfDay(extractStart) - minutesOfDay(existingStart)),
    dayDistance: Math.abs(dayNumber(session.date) - dayNumber(existingDay)),
    description: describeMatch(session, ex, timezone),
  };
}

/**
 * Rank order within a tier. Zero means the two candidates are
 * indistinguishable — the matcher must not choose between them.
 */
function compareCandidates(a: Candidate, b: Candidate): number {
  if (Math.abs(a.sim - b.sim) > 1e-9) return b.sim - a.sim;
  if (a.sameRoom !== b.sameRoom) return a.sameRoom ? -1 : 1;
  if (a.timeDistance !== b.timeDistance) return a.timeDistance - b.timeDistance;
  if (a.dayDistance !== b.dayDistance) return a.dayDistance - b.dayDistance;
  return 0;
}

function toMatchCandidate(candidate: Candidate): MatchCandidate {
  const { ex, description } = candidate;
  const room = ex.roomName || ex.location || "";
  return {
    sessionId: ex.id,
    existingTitle: ex.title,
    existingDay: description.existingDay,
    existingTime: description.existingTime,
    ...(room ? { existingRoom: room } : {}),
    tier: candidate.tier,
    similarity: candidate.sim,
    changes: description.changes,
    message: description.message,
    movesTime: description.movesTime,
    joinedCount: ex.joinedCount ?? 0,
    bookmarkCount: ex.bookmarkCount ?? 0,
    ...(description.speakerRemovals.length ? { speakerRemovals: description.speakerRemovals } : {}),
    ...(description.itemRemovals.length ? { itemRemovals: description.itemRemovals } : {}),
  };
}

/**
 * Everything confirm would write for this pair, as old → new pairs plus the
 * unchecked child-removal proposals (E13.3).
 */
function describeMatch(
  session: ExtractedSession,
  ex: ExistingSessionLite,
  timezone: string,
): MatchDescription {
  const changes: FieldChange[] = [];
  const existingDay = localDayKey(ex.startsAt, timezone);
  if (existingDay !== session.date) {
    changes.push({ field: "day", label: "Day", from: existingDay, to: session.date });
  }

  const fromStart = normalizeClock(ex.startsAt, timezone);
  const fromEnd = normalizeClock(ex.endsAt, timezone);
  const toStart = normalizeTime(session.startTime);
  // Mirror confirm's sessionBounds: a missing or backwards end time becomes
  // start + one hour, so the diff shows what will actually be written.
  const statedEnd = session.endTime ? normalizeTime(session.endTime) : null;
  const toEnd =
    statedEnd && minutesOfDay(statedEnd) > minutesOfDay(toStart)
      ? statedEnd
      : addMinutes(toStart, 60);
  if (fromStart !== toStart || fromEnd !== toEnd) {
    changes.push({
      field: "time",
      label: "Time",
      from: `${fromStart}–${fromEnd}`,
      to: `${toStart}–${toEnd}`,
    });
  }

  const existingRoom = (ex.roomName || ex.location || "").trim();
  if (session.room && session.room.trim() !== existingRoom) {
    changes.push({
      field: "room",
      label: "Room",
      from: existingRoom || "—",
      to: session.room.trim(),
    });
  }
  const existingTrack = (ex.trackName || "").trim();
  if (session.track && session.track.trim() !== existingTrack) {
    changes.push({
      field: "track",
      label: "Track",
      from: existingTrack || "—",
      to: session.track.trim(),
    });
  }
  if (session.title !== ex.title) {
    changes.push({ field: "title", label: "Title", from: ex.title, to: session.title });
  }
  // A description the caller did not supply cannot be diffed; the import
  // bringing one then counts as a change rather than being assumed equal.
  const descriptionUnknown = Boolean(session.description) && ex.description === undefined;
  if (session.description && ex.description !== undefined) {
    const from = (ex.description || "").trim();
    const to = session.description.trim();
    if (from !== to) {
      changes.push({
        field: "description",
        label: "Description",
        from: snip(from) || "—",
        to: snip(to),
      });
    }
  }

  // E13.3: children the source does not mention become explicit,
  // unchecked-by-default removal proposals — confirm never deletes them on
  // its own.
  const extractedSpeakerKeys = new Set(session.speakers.map((n) => normalizeTitle(n)));
  const speakerRemovals: SpeakerRemoval[] = (ex.speakers || [])
    .filter((sp) => !extractedSpeakerKeys.has(normalizeTitle(sp.name)))
    .map((sp) => ({ speakerId: sp.speakerId, name: sp.name, accepted: false }));
  const extractedItems = session.items || [];
  const extractedItemKeys = new Set(extractedItems.map((it) => normalizeTitle(it.title)));
  const itemRemovals: ItemRemoval[] = (ex.items || [])
    .filter((it) => !extractedItemKeys.has(normalizeTitle(it.title)))
    .map((it) => ({ itemId: it.itemId, title: it.title, accepted: false }));

  const linkedSpeakerKeys = ex.speakers
    ? new Set(ex.speakers.map((sp) => normalizeTitle(sp.name)))
    : null;
  const newSpeakers = linkedSpeakerKeys
    ? session.speakers.filter((n) => !linkedSpeakerKeys.has(normalizeTitle(n))).length
    : session.speakers.length;
  const existingItemKeys = ex.items ? new Set(ex.items.map((it) => normalizeTitle(it.title))) : null;
  const newItems = existingItemKeys
    ? extractedItems.filter((it) => !existingItemKeys.has(normalizeTitle(it.title))).length
    : extractedItems.length;
  // Authors and discussants live below ExistingItemLite, so a matched paper
  // carrying them is treated as a possible change rather than silently skipped.
  const authoredItems = extractedItems.filter(
    (it) => it.authors.length > 0 || Boolean(it.discussant),
  ).length;

  const movesTime = changes.some((c) => c.field === "day" || c.field === "time");
  const childWork = newSpeakers + newItems + authoredItems + speakerRemovals.length + itemRemovals.length;
  const changesAnything = changes.length > 0 || childWork > 0 || descriptionUnknown;

  return {
    changes,
    message: changes.length
      ? changes.map((c) => CHANGE_VERB[c.field]).join(", ")
      : "speakers or papers only",
    movesTime,
    speakerRemovals,
    itemRemovals,
    changesAnything,
    existingDay,
    existingTime: `${fromStart}–${fromEnd}`,
  };
}

function sameRoomName(session: ExtractedSession, ex: ExistingSessionLite): boolean {
  const a = (session.room || "").trim().toLowerCase();
  const b = (ex.roomName || ex.location || "").trim().toLowerCase();
  return a.length > 0 && a === b;
}

function minutesOfDay(clock: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(clock);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

function addMinutes(clock: string, minutes: number): string {
  const total = minutesOfDay(clock) + minutes;
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function dayNumber(day: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day.trim());
  if (!m) return 0;
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
}

function snip(text: string, max = 90): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
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
