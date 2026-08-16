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
  internal_checklist: "Internal checklist",
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

export type OverviewAssignment = {
  id: string;
  templateId: string;
  requirementId: string;
  requirementLabel: string;
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
// isLate — passthrough of the server-derived flag
// ---------------------------------------------------------------------------

/** LATE is derived server-side (ER2). The client never recomputes it. */
export function isLate(assignment: Pick<OverviewAssignment, "late">): boolean {
  return assignment.late === true;
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
