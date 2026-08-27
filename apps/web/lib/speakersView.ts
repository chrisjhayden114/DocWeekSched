/**
 * SPK-1 — pure view helpers for the organizer Speakers tab.
 *
 * DOM-free and deterministic, so the chip text, the portal-state derivation
 * and the delete cascade copy are unit-tested without rendering the table
 * (__tests__/speakersView.test.ts). Everything here reads data the console
 * already holds: GET /speakers/, GET /sessions/, and — only when the
 * readiness feature is on — GET /readiness/overview + /readiness/portal-access.
 * Absent readiness data is a first-class case: helpers return null and the
 * table shows an em dash rather than inventing a state.
 */

import type { SubjectRollup } from "./readinessView";

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

/**
 * The full GET /speakers/ row. The console used to type only
 * { id, name, title, affiliation } and threw the rest away; the detail panel
 * edits bio and photoUrl, so the type now matches what the API returns.
 */
export type SpeakerRow = {
  id: string;
  eventId?: string;
  name: string;
  title?: string | null;
  affiliation?: string | null;
  bio?: string | null;
  photoUrl?: string | null;
  sortOrder?: number;
  createdAt?: string;
  /** Join rows to this event's sessions, ordered by the organizer. */
  sessions?: { sessionId: string; sortOrder: number }[];
  /** cfpConversions > 0 = this speaker was converted from a CFP submission. */
  _count?: { cfpConversions?: number };
};

/** A session as the console holds it — only what this tab reads. */
export type SpeakerSession = { id: string; title: string; startsAt?: string | null };

/** GET /readiness/portal-access row (no server-side status field). */
export type SpeakerPortalAccess = {
  id: string;
  speakerId: string;
  email: string;
  invitedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
};

/** Existing StatusChip tone vocabulary — no new chip component. */
export type SpeakerChipTone = "default" | "progress" | "pending" | "published" | "past";

// ---------------------------------------------------------------------------
// CFP badge
// ---------------------------------------------------------------------------

export function isCfpConverted(speaker: SpeakerRow): boolean {
  return (speaker._count?.cfpConversions ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Sessions cell
// ---------------------------------------------------------------------------

/**
 * The sessions this speaker presents, in the organizer's order. Join rows
 * pointing at a session this event no longer has are dropped — the table
 * must not claim a count it can't name.
 */
export function speakerSessions(
  speaker: SpeakerRow,
  sessions: SpeakerSession[],
): SpeakerSession[] {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  return (speaker.sessions ?? [])
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.sessionId.localeCompare(b.sessionId))
    .map((link) => byId.get(link.sessionId))
    .filter((s): s is SpeakerSession => s != null);
}

/** "2 sessions · Opening keynote" — count first, then the one you'd recognise. */
export function sessionsCellText(
  speaker: SpeakerRow,
  sessions: SpeakerSession[],
): string | null {
  const linked = speakerSessions(speaker, sessions);
  if (linked.length === 0) return null;
  const count = `${linked.length} session${linked.length === 1 ? "" : "s"}`;
  return `${count} · ${linked[0].title}`;
}

// ---------------------------------------------------------------------------
// Readiness chip — counts only, never a progress bar (SPK-1 explicitly excludes
// progress bars, engagement stats and approve/reject from this tab).
// ---------------------------------------------------------------------------

export type SpeakerReadinessChip = { label: string; tone: SpeakerChipTone };

/**
 * "3/4 ready (+1 late)". null when this speaker has no readiness rollup —
 * either the feature is off or nothing is assigned to them yet — so the cell
 * can render an em dash instead of a fabricated "0/0".
 */
export function readinessChip(
  rollup: SubjectRollup | null | undefined,
): SpeakerReadinessChip | null {
  if (!rollup || rollup.total === 0) return null;
  const late = rollup.late > 0 ? ` (+${rollup.late} late)` : "";
  return {
    label: `${rollup.ready}/${rollup.total} ready${late}`,
    tone: readinessTone(rollup),
  };
}

function readinessTone(rollup: SubjectRollup): SpeakerChipTone {
  if (rollup.late > 0) return "pending";
  if (rollup.complete) return "published";
  if (rollup.ready > 0) return "progress";
  return "default";
}

/** Index the overview's speaker subjects by speaker id. */
export function rollupsBySpeakerId(
  subjects: { type: string; id: string; rollup: SubjectRollup }[] | null | undefined,
): Map<string, SubjectRollup> {
  const map = new Map<string, SubjectRollup>();
  for (const subject of subjects ?? []) {
    if (subject.type === "speaker") map.set(subject.id, subject.rollup);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Portal state — derived client-side; GET /readiness/portal-access has no
// status field, only the four timestamps.
// ---------------------------------------------------------------------------

export type SpeakerPortalState = "none" | "invited" | "opened" | "revoked" | "expired";

export const PORTAL_STATE_LABELS: Record<SpeakerPortalState, string> = {
  none: "No invite",
  invited: "Invited",
  opened: "Opened",
  revoked: "Revoked",
  expired: "Expired",
};

const PORTAL_STATE_TONES: Record<SpeakerPortalState, SpeakerChipTone> = {
  none: "default",
  invited: "progress",
  opened: "published",
  revoked: "past",
  expired: "pending",
};

/**
 * Precedence matches the Readiness tab's own line: an explicit revoke beats
 * everything, then a lapsed expiry, then evidence they actually opened it,
 * then the bare invite. Same order the organizer would read them in.
 */
export function portalStateFor(
  access: SpeakerPortalAccess | null | undefined,
  now: number = Date.now(),
): SpeakerPortalState {
  if (!access) return "none";
  if (access.revokedAt) return "revoked";
  const expiresAt = Date.parse(access.expiresAt);
  if (Number.isFinite(expiresAt) && expiresAt < now) return "expired";
  if (access.lastUsedAt) return "opened";
  return "invited";
}

export type SpeakerPortalCell = {
  state: SpeakerPortalState;
  label: string;
  tone: SpeakerChipTone;
  email: string | null;
};

export function portalCell(
  access: SpeakerPortalAccess | null | undefined,
  now: number = Date.now(),
): SpeakerPortalCell {
  const state = portalStateFor(access, now);
  return {
    state,
    label: PORTAL_STATE_LABELS[state],
    tone: PORTAL_STATE_TONES[state],
    email: access?.email ?? null,
  };
}

export function accessesBySpeakerId(
  accesses: SpeakerPortalAccess[] | null | undefined,
): Map<string, SpeakerPortalAccess> {
  return new Map((accesses ?? []).map((a) => [a.speakerId, a]));
}

// ---------------------------------------------------------------------------
// Delete cascade copy — every consequence named, counted from the data the
// console already has. Nothing is softened and nothing is omitted.
// ---------------------------------------------------------------------------

export type SpeakerCascadeCounts = {
  /** Sessions the speaker is linked to (the sessions survive). */
  sessions: number;
  /** Readiness assignments that will be deleted outright. */
  readinessAssignments: number;
  /** Assignments carrying a submission — the materials and files that go. */
  submittedMaterials: number;
  /** Whether a portal link exists to be killed. */
  portalAccess: boolean;
  /** CFP submissions that will survive, unlinked. */
  cfpSubmissions: number;
  /**
   * False when the readiness data isn't loaded — the feature is off, or the
   * fetch failed. Either way the assignments may still exist server-side
   * (toggling a feature off preserves its data), so the copy admits the gap
   * rather than reporting a zero it can't stand behind.
   */
  readinessKnown: boolean;
};

/**
 * Counts for one speaker. `assignments` is the overview's assignment list;
 * pass null when readiness is off or the fetch failed, and the copy says so
 * instead of implying there is nothing to lose.
 */
export function speakerCascadeCounts(input: {
  speaker: SpeakerRow;
  sessions: SpeakerSession[];
  assignments:
    | { speakerId?: string | null; latestSubmission?: { id: string } | null }[]
    | null;
  access: SpeakerPortalAccess | null | undefined;
}): SpeakerCascadeCounts {
  const mine = (input.assignments ?? []).filter((a) => a.speakerId === input.speaker.id);
  return {
    sessions: speakerSessions(input.speaker, input.sessions).length,
    readinessAssignments: mine.length,
    submittedMaterials: mine.filter((a) => a.latestSubmission != null).length,
    portalAccess: input.access != null,
    cfpSubmissions: input.speaker._count?.cfpConversions ?? 0,
    readinessKnown: input.assignments != null,
  };
}

/** "Delete “Ada Lovelace”?" */
export function speakerDeleteTitle(name: string): string {
  return `Delete ${quote(name)}?`;
}

/**
 * The ConfirmDialog body: one sentence per consequence, in blast-radius
 * order — what survives, what dies, what quietly stops working.
 */
export function speakerDeleteCascadeCopy(counts: SpeakerCascadeCounts): string {
  const parts: string[] = [];

  if (counts.sessions > 0) {
    const n = counts.sessions;
    parts.push(
      `${n} session${n === 1 ? "" : "s"} lose${n === 1 ? "s" : ""} this speaker but ${
        n === 1 ? "stays" : "stay"
      } on the schedule.`,
    );
  }

  if (!counts.readinessKnown) {
    parts.push(
      "Any readiness assignments, submitted materials and portal access are deleted too — those counts aren't loaded, so they aren't listed here.",
    );
  } else if (counts.readinessAssignments > 0) {
    const n = counts.readinessAssignments;
    const m = counts.submittedMaterials;
    parts.push(
      m > 0
        ? `${n} readiness assignment${n === 1 ? "" : "s"} and ${m} submitted item${
            m === 1 ? "" : "s"
          } — including uploaded files — are deleted.`
        : `${n} readiness assignment${n === 1 ? "" : "s"} ${
            n === 1 ? "is" : "are"
          } deleted; nothing has been submitted against ${n === 1 ? "it" : "them"} yet.`,
    );
  }

  if (counts.readinessKnown && counts.portalAccess) {
    parts.push("Their presenter portal link stops working immediately.");
  }

  if (counts.cfpSubmissions > 0) {
    const n = counts.cfpSubmissions;
    parts.push(
      `${n === 1 ? "The CFP submission" : `The ${n} CFP submissions`} they were converted from ${
        n === 1 ? "is" : "are"
      } kept, but no longer linked to a speaker.`,
    );
  }

  if (parts.length === 0) parts.push("Nothing else in this event is linked to this speaker.");

  parts.push("This can't be undone.");
  return parts.join(" ");
}

function quote(value: string): string {
  return `\u201c${value}\u201d`;
}

// ---------------------------------------------------------------------------
// Name filter — only worth the vertical space once the list stops being
// scannable (the roster uses the same threshold).
// ---------------------------------------------------------------------------

export const SPEAKER_FILTER_MIN_ROWS = 10;

export function shouldShowSpeakerFilter(count: number): boolean {
  return count > SPEAKER_FILTER_MIN_ROWS;
}

export function filterSpeakers(rows: SpeakerRow[], query: string): SpeakerRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => row.name.toLowerCase().includes(q));
}
