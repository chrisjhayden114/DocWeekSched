/**
 * ER5 — which reminder (if any) a presenter is owed right now.
 *
 * Pure and deterministic: same assignments + same ledger + same clock = same
 * plan, with no database, mailer, or Prisma client involved. The sweep
 * (reminderSweep.ts) does the I/O; every calm rule lives here:
 *
 * - Exactly ONE stage is derivable from a due date at any moment — the current
 *   one. A due date 30 days out is worth no reminder; one 3 days out is worth
 *   UPCOMING_7D and nothing else. Stages are never emitted retroactively.
 * - A stage already in the ledger is spent forever, so each of the three
 *   moments can fire at most once per assignment.
 * - Settled work (READY / WAIVED / NOT_APPLICABLE), organizer-only
 *   requirements, undated requirements, and presenters without a live portal
 *   link produce nothing at all.
 *
 * The stage union is written out rather than imported from @prisma/client so
 * this module stays usable without a generated client; the Prisma enum values
 * are assignable to it.
 */

import { evaluatePortalAccess } from "./portalTokens";
import {
  deriveAssignmentState,
  isOrganizerOnlyKind,
  isSettledStatus,
  type AssignmentForDerivation,
} from "./status";

export type ReadinessReminderStage = "UPCOMING_7D" | "UPCOMING_2D" | "OVERDUE";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days-out ceiling for each upcoming stage (nearest first). */
export const UPCOMING_STAGE_DAYS: readonly { stage: ReadinessReminderStage; days: number }[] = [
  { stage: "UPCOMING_2D", days: 2 },
  { stage: "UPCOMING_7D", days: 7 },
];

/**
 * The one stage a due date warrants at `now`, or null when it is too far out.
 *
 * Boundaries are inclusive on the upcoming side (exactly 7 days → UPCOMING_7D,
 * exactly 2 days → UPCOMING_2D) and OVERDUE is strictly past due, matching
 * deriveAssignmentState()'s `late` flag: a deadline landing exactly on `now` is
 * not yet late anywhere in the product.
 */
export function stageForDueAt(
  effectiveDueAt: Date | null,
  now: Date,
): ReadinessReminderStage | null {
  if (!effectiveDueAt || Number.isNaN(effectiveDueAt.getTime())) return null;
  const msUntilDue = effectiveDueAt.getTime() - now.getTime();
  if (msUntilDue < 0) return "OVERDUE";
  for (const { stage, days } of UPCOMING_STAGE_DAYS) {
    if (msUntilDue <= days * DAY_MS) return stage;
  }
  return null;
}

export type ReminderAssignment = AssignmentForDerivation & {
  assignmentId: string;
  requirement: { dueAt: Date | null; label: string; kind: string };
  /** Stages already emailed for this assignment (the ledger rows). */
  sentStages: readonly ReadinessReminderStage[];
};

export type ReminderItem = {
  assignmentId: string;
  label: string;
  dueAt: Date | null;
  late: boolean;
  /** The not-yet-sent stage this item crossed, or null when it is only context. */
  stage: ReadinessReminderStage | null;
};

export type SpeakerReminderPlan = {
  /** Every open item the presenter can act on — the whole ask, in one email. */
  items: ReminderItem[];
  /** Ledger rows to claim: only the items that crossed a fresh boundary. */
  newStages: { assignmentId: string; stage: ReadinessReminderStage }[];
  /** Drives the "…overdue" subject line. */
  anyOverdue: boolean;
};

/** Nearest due date first; undated items last, then stable by label. */
function byDueThenLabel(a: ReminderItem, b: ReminderItem): number {
  if (a.dueAt && b.dueAt) {
    const diff = a.dueAt.getTime() - b.dueAt.getTime();
    if (diff !== 0) return diff;
  } else if (a.dueAt) return -1;
  else if (b.dueAt) return 1;
  return a.label.localeCompare(b.label);
}

/**
 * One presenter's reminder, or null when they are owed nothing.
 *
 * `portal` is the speaker's ReadinessPortalAccess row (null when never
 * invited): no live link means no reminder, because there would be nowhere
 * honest to send them. A presenter whose open items have all been reminded at
 * their current stage also gets null — that is the no-nagging rule.
 */
export function planSpeakerReminder(
  input: {
    portal: { expiresAt: Date; revokedAt: Date | null } | null;
    assignments: readonly ReminderAssignment[];
  },
  now: Date,
): SpeakerReminderPlan | null {
  if (!evaluatePortalAccess(input.portal, now).ok) return null;

  const items: ReminderItem[] = [];
  const newStages: { assignmentId: string; stage: ReadinessReminderStage }[] = [];

  for (const assignment of input.assignments) {
    if (isSettledStatus(assignment.status)) continue;
    if (isOrganizerOnlyKind(assignment.requirement.kind)) continue;

    const derived = deriveAssignmentState(assignment, now);
    const stage = stageForDueAt(derived.effectiveDueAt, now);
    const fresh = stage != null && !assignment.sentStages.includes(stage) ? stage : null;
    if (fresh) newStages.push({ assignmentId: assignment.assignmentId, stage: fresh });

    items.push({
      assignmentId: assignment.assignmentId,
      label: assignment.requirement.label,
      dueAt: derived.effectiveDueAt,
      late: derived.late,
      stage: fresh,
    });
  }

  if (newStages.length === 0) return null;

  items.sort(byDueThenLabel);
  return { items, newStages, anyOverdue: items.some((item) => item.late) };
}
