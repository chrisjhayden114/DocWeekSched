/**
 * ER3a — pure view helpers for the organizer Readiness tab.
 *
 * Everything here is deterministic and DOM-free: shapes mirror the ER2
 * GET /readiness/overview response ({ templates, assignments, subjects }),
 * LATE stays server-derived (isLate is a passthrough — the client never
 * recomputes deadlines), and chipForStatus maps stored statuses onto the
 * existing StatusChip tones. Unit-tested in __tests__/readinessView.test.ts.
 */

// ---------------------------------------------------------------------------
// Enums mirrored from the ER2 API (apps/api/src/lib/readiness/service.ts /
// status.ts). The API validates; these copies only drive selects and labels.
// ---------------------------------------------------------------------------

export const READINESS_REQUIREMENT_KINDS = [
  "short_text",
  "long_text",
  "confirm",
  "select",
  "multi_select",
  "date",
  "url",
  "file",
  "agreement",
  "internal_checklist",
] as const;
export type ReadinessRequirementKind = (typeof READINESS_REQUIREMENT_KINDS)[number];

export const REQUIREMENT_KIND_LABELS: Record<ReadinessRequirementKind, string> = {
  short_text: "Short text",
  long_text: "Long text",
  confirm: "Yes/no confirmation",
  select: "Single select",
  multi_select: "Multiple select",
  date: "Date",
  url: "URL",
  file: "File upload",
  agreement: "Agreement",
  internal_checklist: "Internal task (organizer-only)",
};

/** Optional helper under the Kind select — only kinds that need clarifying copy. */
export const REQUIREMENT_KIND_HELPERS: Partial<Record<ReadinessRequirementKind, string>> = {
  internal_checklist:
    "Tracked by the organizer — never requested from the speaker (e.g. AV booked, contract signed).",
};

export type ReadinessStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "SUBMITTED"
  | "NEEDS_REVIEW"
  | "READY"
  | "WAIVED"
  | "NOT_APPLICABLE";

export const READINESS_STATUS_LABELS: Record<ReadinessStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  SUBMITTED: "Submitted",
  NEEDS_REVIEW: "Needs review",
  READY: "Ready",
  WAIVED: "Waived",
  NOT_APPLICABLE: "N/A",
};

// ---------------------------------------------------------------------------
// Overview response shapes (dates arrive as ISO strings over JSON)
// ---------------------------------------------------------------------------

export type OverviewRequirement = {
  id: string;
  templateId: string;
  label: string;
  helpText: string | null;
  kind: string;
  required: boolean;
  dueAt: string | null;
  sortOrder: number;
  config?: Record<string, unknown>;
};

export type OverviewTemplate = {
  id: string;
  name: string;
  description: string | null;
  requirements: OverviewRequirement[];
};

export type OverviewSubjectRef = {
  type: "speaker" | "session";
  id: string;
  name: string;
};

export type SubjectRollup = {
  total: number;
  ready: number;
  waived: number;
  open: number;
  late: number;
  complete: boolean;
};

export type OverviewLatestSubmission = {
  id: string;
  value?: unknown;
  fileName?: string | null;
  /** Stored MIME — drives Preview vs Download (ER4.5). */
  fileMime?: string | null;
  submittedAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectedReason: string | null;
};

export type OverviewAssignment = {
  id: string;
  templateId: string;
  requirementId: string;
  requirementLabel: string;
  requirementKind?: string;
  subject: OverviewSubjectRef;
  status: ReadinessStatus;
  /** Server-derived: past effective due date and not READY/WAIVED/N-A. */
  late: boolean;
  /** dueAtOverride ?? requirement.dueAt (null = no deadline). */
  effectiveDueAt: string | null;
  dueAtOverride: string | null;
  waivedAt: string | null;
  waivedById: string | null;
  sessionItemTitle?: string | null;
  latestSubmission?: OverviewLatestSubmission | null;
};

export type ReadinessOverview = {
  templates: OverviewTemplate[];
  assignments: OverviewAssignment[];
  subjects: Array<OverviewSubjectRef & { rollup: SubjectRollup }>;
};

// ---------------------------------------------------------------------------
// buildSubjectRows — group assignments per subject, ordered
// ---------------------------------------------------------------------------

export type SubjectRow = OverviewSubjectRef & {
  /** Stable key: "speaker:<id>" / "session:<id>". */
  key: string;
  rollup: SubjectRollup;
  /** This subject's assignments, in template → requirement sortOrder order. */
  assignments: OverviewAssignment[];
};

export function subjectKey(subject: { type: string; id: string }): string {
  return `${subject.type}:${subject.id}`;
}

/**
 * One row per overview subject (the server already sorts subjects by type
 * then name), with that subject's assignments attached in a stable order:
 * template order, then the requirement order inside each template (the
 * overview lists requirements already sorted by sortOrder). Assignments
 * whose requirement no longer appears in templates sort last, by label.
 */
export function buildSubjectRows(overview: ReadinessOverview): SubjectRow[] {
  const requirementRank = new Map<string, number>();
  let rank = 0;
  for (const template of overview.templates) {
    for (const requirement of template.requirements) {
      requirementRank.set(requirement.id, rank);
      rank += 1;
    }
  }

  const bySubject = new Map<string, OverviewAssignment[]>();
  for (const assignment of overview.assignments) {
    const key = subjectKey(assignment.subject);
    const list = bySubject.get(key);
    if (list) list.push(assignment);
    else bySubject.set(key, [assignment]);
  }

  return overview.subjects.map((subject) => {
    const key = subjectKey(subject);
    const assignments = (bySubject.get(key) ?? []).slice().sort((a, b) => {
      const ra = requirementRank.get(a.requirementId) ?? Number.MAX_SAFE_INTEGER;
      const rb = requirementRank.get(b.requirementId) ?? Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return (
        a.requirementLabel.localeCompare(b.requirementLabel) || a.id.localeCompare(b.id)
      );
    });
    return { ...subject, key, assignments };
  });
}

// ---------------------------------------------------------------------------
// chipForStatus — stored status → StatusChip props
// ---------------------------------------------------------------------------

export type StatusChipProps = {
  /** Feeds StatusChip's tone mapping (existing tones + the ER3a "progress"). */
  chipStatus: "default" | "progress" | "pending" | "published" | "past";
  label: string;
};

/**
 * NOT_STARTED gray / IN_PROGRESS blue / SUBMITTED + NEEDS_REVIEW amber /
 * READY green / WAIVED + NOT_APPLICABLE muted — expressed through the
 * existing StatusChip tone vocabulary so no new chip component appears.
 */
export function chipForStatus(status: ReadinessStatus): StatusChipProps {
  switch (status) {
    case "IN_PROGRESS":
      return { chipStatus: "progress", label: READINESS_STATUS_LABELS[status] };
    case "SUBMITTED":
    case "NEEDS_REVIEW":
      return { chipStatus: "pending", label: READINESS_STATUS_LABELS[status] };
    case "READY":
      return { chipStatus: "published", label: READINESS_STATUS_LABELS[status] };
    case "WAIVED":
    case "NOT_APPLICABLE":
      return { chipStatus: "past", label: READINESS_STATUS_LABELS[status] };
    case "NOT_STARTED":
    default:
      return { chipStatus: "default", label: READINESS_STATUS_LABELS[status] };
  }
}

// ---------------------------------------------------------------------------
// portalAssignmentChip — presenter-portal card chip (same source as organizer)
// ---------------------------------------------------------------------------

/**
 * GET /portal/:token assignment shape the portal card needs for its chip.
 * The card body infers "Submitted ✓" from `latestSubmission`. The corner chip
 * used to follow stored `status` only — a stale NOT_STARTED then stayed on
 * "Not started" after a real submission. Effective status is the stored
 * assignment status, reconciled with the latest submission so the chip uses
 * the same chipForStatus mapping as the organizer table.
 */
export type PortalAssignmentForChip = {
  status: ReadinessStatus;
  latestSubmission?: { approvedAt?: string | null; rejectedAt?: string | null } | null;
};

/** Stored assignment status, or SUBMITTED/READY/IN_PROGRESS when a submission is ahead of a stale NOT_STARTED. */
export function portalAssignmentStatus(assignment: PortalAssignmentForChip): ReadinessStatus {
  const stored = assignment.status;
  if (stored !== "NOT_STARTED") return stored;
  const sub = assignment.latestSubmission;
  if (!sub) return stored;
  if (sub.approvedAt) return "READY";
  if (sub.rejectedAt) return "IN_PROGRESS";
  return "SUBMITTED";
}

/** Same chipForStatus mapping as the organizer Readiness table. */
export function portalAssignmentChip(assignment: PortalAssignmentForChip): StatusChipProps {
  return chipForStatus(portalAssignmentStatus(assignment));
}

// ---------------------------------------------------------------------------
// isLate — passthrough of the server-derived flag
// ---------------------------------------------------------------------------

/** LATE is derived server-side (ER2). The client never recomputes it. */
export function isLate(assignment: Pick<OverviewAssignment, "late">): boolean {
  return assignment.late === true;
}

// ---------------------------------------------------------------------------
// isOpenStatus — the canonical "still requires action" predicate
// ---------------------------------------------------------------------------

/**
 * Mirrors the server's SETTLED set (lib/readiness/status.ts): READY, WAIVED
 * and NOT_APPLICABLE are settled; everything else is open work.
 */
export function isOpenStatus(status: ReadinessStatus): boolean {
  return status !== "READY" && status !== "WAIVED" && status !== "NOT_APPLICABLE";
}

// ---------------------------------------------------------------------------
// summaryCounts — the overview strip ("N subjects · X complete · Y open · Z late")
// ---------------------------------------------------------------------------

export type SummaryCounts = {
  /** Subjects being tracked. */
  subjects: number;
  /** Subjects whose every assignment is settled (rollup.complete). */
  complete: number;
  /** Open ASSIGNMENTS across all subjects (rollup.open summed). */
  open: number;
  /** Late ASSIGNMENTS across all subjects (rollup.late summed). */
  late: number;
};

/** Derived entirely from the server-computed rollups — nothing recomputed. */
export function summaryCounts(rows: SubjectRow[]): SummaryCounts {
  const counts: SummaryCounts = { subjects: rows.length, complete: 0, open: 0, late: 0 };
  for (const row of rows) {
    if (row.rollup.complete) counts.complete += 1;
    counts.open += row.rollup.open;
    counts.late += row.rollup.late;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// needsAttention — the exception-first list
// ---------------------------------------------------------------------------

/**
 * Assignments an organizer should look at now: server-derived late, or
 * NEEDS_REVIEW. Settled statuses (ready/waived/N-A) are excluded even if a
 * response ever carried a stale late flag for one. Sorted by effective due
 * date ascending with no-deadline items last; ties break by subject name,
 * then requirement label, then id, so the order is stable. `limit` caps the
 * returned list (the UI shows 8 with a "show all" expander).
 */
export function needsAttention(
  rows: SubjectRow[],
  limit: number = Number.POSITIVE_INFINITY,
): OverviewAssignment[] {
  const hits: OverviewAssignment[] = [];
  for (const row of rows) {
    for (const a of row.assignments) {
      if (!isOpenStatus(a.status)) continue;
      if (isLate(a) || a.status === "NEEDS_REVIEW") hits.push(a);
    }
  }
  hits.sort((a, b) => {
    const da = a.effectiveDueAt ? Date.parse(a.effectiveDueAt) : Number.MAX_SAFE_INTEGER;
    const db = b.effectiveDueAt ? Date.parse(b.effectiveDueAt) : Number.MAX_SAFE_INTEGER;
    if (da !== db) return da - db;
    return (
      a.subject.name.localeCompare(b.subject.name) ||
      a.requirementLabel.localeCompare(b.requirementLabel) ||
      a.id.localeCompare(b.id)
    );
  });
  return hits.slice(0, limit);
}

// ---------------------------------------------------------------------------
// filterRows — client-side subject filter
// ---------------------------------------------------------------------------

export type ReadinessStatusFilter = "all" | "open" | "late" | "ready";

/**
 * Subject-name substring filter (case-insensitive, whitespace-trimmed)
 * combined with a rollup-based status filter: Open = anything still
 * requiring action, Late = at least one open assignment past due,
 * Ready = every assignment settled (rollup.complete).
 */
export function filterRows(
  rows: SubjectRow[],
  query: string,
  statusFilter: ReadinessStatusFilter,
): SubjectRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (q && !row.name.toLowerCase().includes(q)) return false;
    if (statusFilter === "open") return row.rollup.open > 0;
    if (statusFilter === "late") return row.rollup.late > 0;
    if (statusFilter === "ready") return row.rollup.complete;
    return true;
  });
}

/**
 * ER4.5 — mirrors API `readinessFileDisposition`: PDF and png/jpeg open
 * inline in the browser; PowerPoint/Word and unknown types download.
 * When `fileMime` is missing, falls back to the filename extension.
 */
export const READINESS_OFFICE_DOWNLOAD_NOTE =
  "PowerPoint and Word files download — browsers can't display them.";

export function isReadinessFilePreviewable(
  mime?: string | null,
  fileName?: string | null,
): boolean {
  const m = (mime || "").trim().toLowerCase();
  if (m === "application/pdf" || m === "image/png" || m === "image/jpeg") return true;
  if (m) return false;
  const name = (fileName || "").trim().toLowerCase();
  return (
    name.endsWith(".pdf") ||
    name.endsWith(".png") ||
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg")
  );
}
