/**
 * ER2 — derived readiness status (audit doc §10.1, plan §6.1.D).
 *
 * LATE (and later BLOCKED) are DERIVED, never stored: the stored
 * ReadinessAssignmentStatus enum holds only organizer/presenter-driven
 * states. Everything here is pure and deterministic — same input, same
 * output — and no percentage is ever persisted.
 *
 * The status union is written out (rather than imported from @prisma/client)
 * so this module stays pure and usable without a generated client; the
 * Prisma enum values are assignable to it.
 */

export type StoredReadinessStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "SUBMITTED"
  | "NEEDS_REVIEW"
  | "READY"
  | "WAIVED"
  | "NOT_APPLICABLE";

/** Settled statuses: never late, and not "open" work. */
const SETTLED: ReadonlySet<StoredReadinessStatus> = new Set([
  "READY",
  "WAIVED",
  "NOT_APPLICABLE",
]);

/** READY / WAIVED / NOT_APPLICABLE — nothing left for anyone to do. */
export function isSettledStatus(status: StoredReadinessStatus): boolean {
  return SETTLED.has(status);
}

/**
 * Requirement kinds the presenter never sees: organizer-side tracking only.
 * The portal hides them, and reminders must never mention them.
 */
export const ORGANIZER_ONLY_REQUIREMENT_KINDS: ReadonlySet<string> = new Set([
  "internal_checklist",
]);

export function isOrganizerOnlyKind(kind: string): boolean {
  return ORGANIZER_ONLY_REQUIREMENT_KINDS.has(kind);
}

export type AssignmentForDerivation = {
  status: StoredReadinessStatus;
  /** Per-assignment override; beats the requirement's dueAt when set. */
  dueAtOverride: Date | null;
  requirement: { dueAt: Date | null };
};

export type DerivedAssignmentState = {
  status: StoredReadinessStatus;
  /** dueAtOverride ?? requirement.dueAt (null = no deadline). */
  effectiveDueAt: Date | null;
  /** Past effective due date and not READY/WAIVED/NOT_APPLICABLE. */
  late: boolean;
};

export function deriveAssignmentState(
  assignment: AssignmentForDerivation,
  now: Date,
): DerivedAssignmentState {
  const effectiveDueAt = assignment.dueAtOverride ?? assignment.requirement.dueAt;
  const late =
    effectiveDueAt != null &&
    effectiveDueAt.getTime() < now.getTime() &&
    !SETTLED.has(assignment.status);
  return { status: assignment.status, effectiveDueAt, late };
}

export type SubjectRollup = {
  total: number;
  /** READY count. */
  ready: number;
  /** WAIVED + NOT_APPLICABLE count (excused work — neither ready nor open). */
  waived: number;
  /** Everything still requiring action: total - ready - waived. */
  open: number;
  /** Open assignments past their effective due date. */
  late: number;
  /** True when the subject has assignments and none remain open. */
  complete: boolean;
};

/**
 * Roll up one speaker/session subject's assignments. Counts only — no stored
 * percentage (plan §6.1.D). An empty subject is not complete: there is
 * nothing to be ready with.
 */
export function rollupSubject(
  assignments: readonly AssignmentForDerivation[],
  now: Date,
): SubjectRollup {
  let ready = 0;
  let waived = 0;
  let late = 0;
  for (const assignment of assignments) {
    if (assignment.status === "READY") ready += 1;
    else if (assignment.status === "WAIVED" || assignment.status === "NOT_APPLICABLE") waived += 1;
    if (deriveAssignmentState(assignment, now).late) late += 1;
  }
  const total = assignments.length;
  const open = total - ready - waived;
  return { total, ready, waived, open, late, complete: total > 0 && open === 0 };
}
