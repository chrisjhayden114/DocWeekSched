import { describe, expect, it } from "vitest";
import {
  buildSubjectRows,
  chipForStatus,
  portalAssignmentChip,
  filterRows,
  isLate,
  isOpenStatus,
  isReadinessFilePreviewable,
  needsAttention,
  subjectKey,
  summaryCounts,
  REQUIREMENT_KIND_HELPERS,
  REQUIREMENT_KIND_LABELS,
  type OverviewAssignment,
  type OverviewSubjectRef,
  type ReadinessOverview,
  type ReadinessStatus,
  type SubjectRollup,
} from "../lib/readinessView";

/**
 * ER3a — fixtures shaped like the ER2 GET /readiness/overview response
 * (apps/api/src/lib/readiness/service.ts getReadinessOverview): templates
 * with sorted requirements, flat shaped assignments with server-derived
 * `late`, and subjects sorted by type then name with rollups attached.
 */

const speakerAda: OverviewSubjectRef = { type: "speaker", id: "spk-ada", name: "Ada Lovelace" };
const speakerGrace: OverviewSubjectRef = { type: "speaker", id: "spk-grace", name: "Grace Hopper" };
const sessionKeynote: OverviewSubjectRef = { type: "session", id: "ses-key", name: "Opening keynote" };

function assignment(
  over: Partial<OverviewAssignment> & {
    id: string;
    requirementId: string;
    requirementLabel: string;
    subject: OverviewSubjectRef;
  },
): OverviewAssignment {
  return {
    templateId: "tpl-speaker",
    status: "NOT_STARTED",
    late: false,
    effectiveDueAt: null,
    dueAtOverride: null,
    waivedAt: null,
    waivedById: null,
    sessionItemTitle: null,
    ...over,
  };
}

function rollup(over: Partial<SubjectRollup> = {}): SubjectRollup {
  return { total: 0, ready: 0, waived: 0, open: 0, late: 0, complete: false, ...over };
}

/** Two templates; assignments deliberately out of requirement order. */
const overview: ReadinessOverview = {
  templates: [
    {
      id: "tpl-speaker",
      name: "Keynote speaker",
      description: "Everything a keynote needs",
      requirements: [
        {
          id: "req-bio",
          templateId: "tpl-speaker",
          label: "Bio",
          helpText: null,
          kind: "long_text",
          required: true,
          dueAt: "2026-09-01T12:00:00.000Z",
          sortOrder: 0,
        },
        {
          id: "req-headshot",
          templateId: "tpl-speaker",
          label: "Headshot",
          helpText: null,
          kind: "file",
          required: true,
          dueAt: null,
          sortOrder: 1,
        },
      ],
    },
    {
      id: "tpl-session",
      name: "Session",
      description: null,
      requirements: [
        {
          id: "req-av",
          templateId: "tpl-session",
          label: "AV needs",
          helpText: null,
          kind: "short_text",
          required: false,
          dueAt: null,
          sortOrder: 0,
        },
      ],
    },
  ],
  assignments: [
    // Ada's headshot listed BEFORE her bio — buildSubjectRows must reorder.
    assignment({
      id: "a-ada-headshot",
      requirementId: "req-headshot",
      requirementLabel: "Headshot",
      subject: speakerAda,
      status: "READY",
    }),
    assignment({
      id: "a-ada-bio",
      requirementId: "req-bio",
      requirementLabel: "Bio",
      subject: speakerAda,
      status: "IN_PROGRESS",
      late: true,
      effectiveDueAt: "2026-09-01T12:00:00.000Z",
    }),
    assignment({
      id: "a-grace-bio",
      requirementId: "req-bio",
      requirementLabel: "Bio",
      subject: speakerGrace,
      status: "WAIVED",
      waivedAt: "2026-08-10T09:00:00.000Z",
      waivedById: "user-1",
    }),
    assignment({
      id: "a-grace-headshot",
      requirementId: "req-headshot",
      requirementLabel: "Headshot",
      subject: speakerGrace,
      status: "READY",
    }),
    assignment({
      id: "a-key-av",
      templateId: "tpl-session",
      requirementId: "req-av",
      requirementLabel: "AV needs",
      subject: sessionKeynote,
      status: "NOT_STARTED",
    }),
    // Requirement deleted from its template since assignment — sorts last.
    assignment({
      id: "a-ada-orphan",
      requirementId: "req-gone",
      requirementLabel: "Old agreement",
      subject: speakerAda,
      status: "NOT_STARTED",
    }),
  ],
  subjects: [
    { ...sessionKeynote, rollup: rollup({ total: 1, open: 1 }) },
    { ...speakerAda, rollup: rollup({ total: 3, ready: 1, open: 2, late: 1 }) },
    { ...speakerGrace, rollup: rollup({ total: 2, ready: 1, waived: 1, open: 0, complete: true }) },
  ],
};

describe("subjectKey", () => {
  it("is type-qualified so a speaker and session with the same id stay distinct", () => {
    expect(subjectKey({ type: "speaker", id: "x1" })).toBe("speaker:x1");
    expect(subjectKey({ type: "session", id: "x1" })).toBe("session:x1");
  });
});

describe("REQUIREMENT_KIND_LABELS", () => {
  it('labels internal_checklist as an organizer-only task (stored kind unchanged)', () => {
    expect(REQUIREMENT_KIND_LABELS.internal_checklist).toBe("Internal task (organizer-only)");
    expect(REQUIREMENT_KIND_HELPERS.internal_checklist).toMatch(/never requested from the speaker/i);
  });
});

describe("buildSubjectRows", () => {
  it("keeps the server's subject order and attaches rollups", () => {
    const rows = buildSubjectRows(overview);
    expect(rows.map((r) => r.key)).toEqual([
      "session:ses-key",
      "speaker:spk-ada",
      "speaker:spk-grace",
    ]);
    expect(rows[1].rollup).toEqual(overview.subjects[1].rollup);
    expect(rows[0].name).toBe("Opening keynote");
  });

  it("groups each subject's assignments", () => {
    const rows = buildSubjectRows(overview);
    const ada = rows.find((r) => r.key === "speaker:spk-ada")!;
    expect(ada.assignments).toHaveLength(3);
    expect(ada.assignments.every((a) => a.subject.id === "spk-ada")).toBe(true);
    const keynote = rows.find((r) => r.key === "session:ses-key")!;
    expect(keynote.assignments.map((a) => a.id)).toEqual(["a-key-av"]);
  });

  it("orders assignments by template requirement order, orphans last", () => {
    const rows = buildSubjectRows(overview);
    const ada = rows.find((r) => r.key === "speaker:spk-ada")!;
    // Bio (sortOrder 0) before Headshot (sortOrder 1) despite response order;
    // the assignment whose requirement left its template sorts last.
    expect(ada.assignments.map((a) => a.id)).toEqual([
      "a-ada-bio",
      "a-ada-headshot",
      "a-ada-orphan",
    ]);
  });

  it("returns a row with no assignments for a subject the response lists bare", () => {
    const bare: ReadinessOverview = {
      templates: [],
      assignments: [],
      subjects: [{ ...speakerAda, rollup: rollup() }],
    };
    const rows = buildSubjectRows(bare);
    expect(rows).toHaveLength(1);
    expect(rows[0].assignments).toEqual([]);
  });

  it("does not mutate the overview's assignment array", () => {
    const before = overview.assignments.map((a) => a.id);
    buildSubjectRows(overview);
    expect(overview.assignments.map((a) => a.id)).toEqual(before);
  });
});

describe("chipForStatus", () => {
  it("maps every stored status to the specified tone", () => {
    expect(chipForStatus("NOT_STARTED")).toEqual({ chipStatus: "default", label: "Not started" });
    expect(chipForStatus("IN_PROGRESS")).toEqual({ chipStatus: "progress", label: "In progress" });
    expect(chipForStatus("SUBMITTED")).toEqual({ chipStatus: "pending", label: "Submitted" });
    expect(chipForStatus("NEEDS_REVIEW")).toEqual({ chipStatus: "pending", label: "Needs review" });
    expect(chipForStatus("READY")).toEqual({ chipStatus: "published", label: "Ready" });
    expect(chipForStatus("WAIVED")).toEqual({ chipStatus: "past", label: "Waived" });
    expect(chipForStatus("NOT_APPLICABLE")).toEqual({ chipStatus: "past", label: "N/A" });
  });

  it("falls back to the gray default tone for an unknown status", () => {
    const chip = chipForStatus("SOMETHING_NEW" as ReadinessStatus);
    expect(chip.chipStatus).toBe("default");
  });
});

describe("portal view model", () => {
  it('maps a SUBMITTED assignment with a submission to a "Submitted" chip', () => {
    expect(
      portalAssignmentChip({
        status: "SUBMITTED",
        latestSubmission: {
          approvedAt: null,
          rejectedAt: null,
        },
      }),
    ).toEqual({ chipStatus: "pending", label: "Submitted" });
  });
});

describe("isLate", () => {
  it("passes the server-derived flag through without recomputing dates", () => {
    // effectiveDueAt long past, but the server said not late (e.g. READY) —
    // the client must trust the derived flag, not the timestamp.
    expect(
      isLate(
        assignment({
          id: "x",
          requirementId: "r",
          requirementLabel: "R",
          subject: speakerAda,
          status: "READY",
          late: false,
          effectiveDueAt: "2000-01-01T00:00:00.000Z",
        }),
      ),
    ).toBe(false);
    expect(isLate({ late: true })).toBe(true);
    expect(isLate({ late: false })).toBe(false);
  });
});

describe("isOpenStatus", () => {
  it("treats exactly READY/WAIVED/NOT_APPLICABLE as settled", () => {
    expect(isOpenStatus("READY")).toBe(false);
    expect(isOpenStatus("WAIVED")).toBe(false);
    expect(isOpenStatus("NOT_APPLICABLE")).toBe(false);
    expect(isOpenStatus("NOT_STARTED")).toBe(true);
    expect(isOpenStatus("IN_PROGRESS")).toBe(true);
    expect(isOpenStatus("SUBMITTED")).toBe(true);
    expect(isOpenStatus("NEEDS_REVIEW")).toBe(true);
  });
});

describe("summaryCounts", () => {
  it("counts subjects, complete subjects, and summed open/late assignments", () => {
    // Fixture rollups: keynote 1 open · Ada 2 open 1 late · Grace complete.
    expect(summaryCounts(buildSubjectRows(overview))).toEqual({
      subjects: 3,
      complete: 1,
      open: 3,
      late: 1,
    });
  });

  it("is all zeros for no rows", () => {
    expect(summaryCounts([])).toEqual({ subjects: 0, complete: 0, open: 0, late: 0 });
  });
});

describe("needsAttention", () => {
  /** Dedicated fixture: mixed late / needs-review / settled assignments. */
  const attentionOverview: ReadinessOverview = {
    templates: [],
    assignments: [
      // No deadline, NEEDS_REVIEW — included, sorts after every dated item.
      assignment({
        id: "n-review-undated",
        requirementId: "r1",
        requirementLabel: "Bio",
        subject: speakerGrace,
        status: "NEEDS_REVIEW",
      }),
      // Late, due latest of the dated items.
      assignment({
        id: "n-late-sep",
        requirementId: "r2",
        requirementLabel: "Slides",
        subject: speakerAda,
        status: "NOT_STARTED",
        late: true,
        effectiveDueAt: "2026-09-15T12:00:00.000Z",
      }),
      // Late, due earliest — must come first.
      assignment({
        id: "n-late-aug",
        requirementId: "r3",
        requirementLabel: "Headshot",
        subject: sessionKeynote,
        status: "IN_PROGRESS",
        late: true,
        effectiveDueAt: "2026-08-01T12:00:00.000Z",
      }),
      // NEEDS_REVIEW with a mid deadline (not late) — included, sorted by date.
      assignment({
        id: "n-review-dated",
        requirementId: "r4",
        requirementLabel: "AV needs",
        subject: speakerAda,
        status: "NEEDS_REVIEW",
        effectiveDueAt: "2026-09-01T12:00:00.000Z",
      }),
      // READY past its date — server says not late; excluded either way.
      assignment({
        id: "n-ready",
        requirementId: "r5",
        requirementLabel: "Agreement",
        subject: speakerAda,
        status: "READY",
        effectiveDueAt: "2020-01-01T00:00:00.000Z",
      }),
      // WAIVED with a defensively-stale late flag — settled statuses stay out.
      assignment({
        id: "n-waived",
        requirementId: "r6",
        requirementLabel: "Consent",
        subject: speakerGrace,
        status: "WAIVED",
        late: true,
        effectiveDueAt: "2020-01-01T00:00:00.000Z",
      }),
      // Open but neither late nor needs-review — not an exception.
      assignment({
        id: "n-calm",
        requirementId: "r7",
        requirementLabel: "Travel",
        subject: speakerGrace,
        status: "IN_PROGRESS",
      }),
    ],
    subjects: [
      { ...sessionKeynote, rollup: rollup({ total: 1, open: 1, late: 1 }) },
      { ...speakerAda, rollup: rollup({ total: 3, ready: 1, open: 2, late: 1 }) },
      { ...speakerGrace, rollup: rollup({ total: 3, waived: 1, open: 2 }) },
    ],
  };
  const attentionRows = buildSubjectRows(attentionOverview);

  it("includes late and NEEDS_REVIEW, excludes ready/waived and calm open work", () => {
    const ids = needsAttention(attentionRows).map((a) => a.id);
    expect(ids).toContain("n-late-sep");
    expect(ids).toContain("n-late-aug");
    expect(ids).toContain("n-review-undated");
    expect(ids).toContain("n-review-dated");
    expect(ids).not.toContain("n-ready");
    expect(ids).not.toContain("n-waived");
    expect(ids).not.toContain("n-calm");
  });

  it("sorts by effective due date ascending, undated last", () => {
    expect(needsAttention(attentionRows).map((a) => a.id)).toEqual([
      "n-late-aug",
      "n-review-dated",
      "n-late-sep",
      "n-review-undated",
    ]);
  });

  it("caps the list at the given limit, keeping the earliest-due items", () => {
    expect(needsAttention(attentionRows, 2).map((a) => a.id)).toEqual([
      "n-late-aug",
      "n-review-dated",
    ]);
    expect(needsAttention(attentionRows, 0)).toEqual([]);
  });

  it("returns everything when no limit is passed", () => {
    expect(needsAttention(attentionRows)).toHaveLength(4);
  });

  it("is empty when nothing needs attention", () => {
    const calm = buildSubjectRows({
      templates: [],
      assignments: [
        assignment({
          id: "c1",
          requirementId: "r1",
          requirementLabel: "Bio",
          subject: speakerAda,
          status: "READY",
        }),
      ],
      subjects: [{ ...speakerAda, rollup: rollup({ total: 1, ready: 1, complete: true }) }],
    });
    expect(needsAttention(calm)).toEqual([]);
  });
});

describe("filterRows", () => {
  const rows = buildSubjectRows(overview);

  it('returns everything for "all" with an empty query', () => {
    expect(filterRows(rows, "", "all")).toHaveLength(3);
  });

  it("matches subject names case-insensitively, trimming the query", () => {
    expect(filterRows(rows, "  ADA ", "all").map((r) => r.key)).toEqual(["speaker:spk-ada"]);
    expect(filterRows(rows, "keynote", "all").map((r) => r.key)).toEqual(["session:ses-key"]);
    expect(filterRows(rows, "nobody", "all")).toEqual([]);
  });

  it('"open" keeps subjects with open work', () => {
    expect(filterRows(rows, "", "open").map((r) => r.key)).toEqual([
      "session:ses-key",
      "speaker:spk-ada",
    ]);
  });

  it('"late" keeps subjects with at least one late assignment', () => {
    expect(filterRows(rows, "", "late").map((r) => r.key)).toEqual(["speaker:spk-ada"]);
  });

  it('"ready" keeps only complete subjects (waived counts as settled)', () => {
    expect(filterRows(rows, "", "ready").map((r) => r.key)).toEqual(["speaker:spk-grace"]);
  });

  it("combines the query with the status filter", () => {
    expect(filterRows(rows, "grace", "open")).toEqual([]);
    expect(filterRows(rows, "grace", "ready").map((r) => r.key)).toEqual(["speaker:spk-grace"]);
  });
});

describe("isReadinessFilePreviewable (ER4.5)", () => {
  it("previews pdf and png/jpeg; Office and unknown download", () => {
    expect(isReadinessFilePreviewable("application/pdf")).toBe(true);
    expect(isReadinessFilePreviewable("image/png")).toBe(true);
    expect(isReadinessFilePreviewable("image/jpeg")).toBe(true);
    expect(
      isReadinessFilePreviewable(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ),
    ).toBe(false);
    expect(
      isReadinessFilePreviewable(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(false);
    expect(isReadinessFilePreviewable(null, "deck.pdf")).toBe(true);
    expect(isReadinessFilePreviewable(null, "talk.pptx")).toBe(false);
  });
});
