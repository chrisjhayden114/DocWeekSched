/**
 * ER5 — reminder stage derivation. Every calm rule the automatic reminders
 * promise is decided here, with no database and no mailer: one stage per due
 * date at any moment, each stage spent forever once sent, and nothing at all
 * for settled work, organizer-only requirements, or presenters without a live
 * portal link.
 */

import { describe, expect, it } from "vitest";
import {
  planSpeakerReminder,
  stageForDueAt,
  type ReadinessReminderStage,
  type ReminderAssignment,
} from "../lib/readiness/reminderStages";
import type { StoredReadinessStatus } from "../lib/readiness/status";

const NOW = new Date("2026-08-16T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

/** A due date `days` from NOW (negative = in the past). */
function inDays(days: number, offsetMs = 0): Date {
  return new Date(NOW.getTime() + days * DAY_MS + offsetMs);
}

const LIVE_PORTAL = { expiresAt: inDays(20), revokedAt: null };

function assignment(
  over: Partial<ReminderAssignment> & { assignmentId: string },
): ReminderAssignment {
  return {
    status: "NOT_STARTED" as StoredReadinessStatus,
    dueAtOverride: null,
    requirement: { dueAt: inDays(1), label: "Slides", kind: "file" },
    sentStages: [],
    ...over,
  };
}

describe("stageForDueAt (ER5)", () => {
  it("returns the one stage a due date warrants, never a list", () => {
    expect(stageForDueAt(inDays(30), NOW)).toBeNull();
    expect(stageForDueAt(inDays(7), NOW)).toBe("UPCOMING_7D");
    expect(stageForDueAt(inDays(2), NOW)).toBe("UPCOMING_2D");
    expect(stageForDueAt(inDays(-1), NOW)).toBe("OVERDUE");
  });

  it("treats the 7-day and 2-day boundaries as inclusive, to the millisecond", () => {
    expect(stageForDueAt(inDays(7, 1), NOW)).toBeNull();
    expect(stageForDueAt(inDays(7), NOW)).toBe("UPCOMING_7D");
    expect(stageForDueAt(inDays(2, 1), NOW)).toBe("UPCOMING_7D");
    expect(stageForDueAt(inDays(2), NOW)).toBe("UPCOMING_2D");
  });

  it("a deadline landing exactly on now is not yet overdue (matches the late flag)", () => {
    expect(stageForDueAt(NOW, NOW)).toBe("UPCOMING_2D");
    expect(stageForDueAt(inDays(0, -1), NOW)).toBe("OVERDUE");
  });

  it("an undated requirement is never a reminder", () => {
    expect(stageForDueAt(null, NOW)).toBeNull();
    expect(stageForDueAt(new Date("not a date"), NOW)).toBeNull();
  });
});

describe("planSpeakerReminder — what fires (ER5)", () => {
  it("aggregates one presenter's open items into a single plan", () => {
    const plan = planSpeakerReminder(
      {
        portal: LIVE_PORTAL,
        assignments: [
          assignment({
            assignmentId: "a-bio",
            requirement: { dueAt: inDays(5), label: "Bio", kind: "short_text" },
          }),
          assignment({
            assignmentId: "a-slides",
            requirement: { dueAt: inDays(1), label: "Slides", kind: "file" },
          }),
          assignment({
            assignmentId: "a-headshot",
            requirement: { dueAt: inDays(60), label: "Headshot", kind: "file" },
          }),
        ],
      },
      NOW,
    );

    expect(plan).not.toBeNull();
    // Nearest deadline first, and the far-future item rides along as context.
    expect(plan!.items.map((item) => item.label)).toEqual(["Slides", "Bio", "Headshot"]);
    expect(plan!.newStages).toEqual([
      { assignmentId: "a-bio", stage: "UPCOMING_7D" },
      { assignmentId: "a-slides", stage: "UPCOMING_2D" },
    ]);
    // The 60-days-out item is listed but claims no stage: it is not why we wrote.
    expect(plan!.items.find((item) => item.label === "Headshot")!.stage).toBeNull();
    expect(plan!.anyOverdue).toBe(false);
  });

  it("undated open items ride along as context but never trigger an email alone", () => {
    const undated = assignment({
      assignmentId: "a-undated",
      requirement: { dueAt: null, label: "AV needs", kind: "long_text" },
    });
    expect(planSpeakerReminder({ portal: LIVE_PORTAL, assignments: [undated] }, NOW)).toBeNull();

    const plan = planSpeakerReminder(
      {
        portal: LIVE_PORTAL,
        assignments: [undated, assignment({ assignmentId: "a-slides" })],
      },
      NOW,
    );
    expect(plan!.newStages).toEqual([{ assignmentId: "a-slides", stage: "UPCOMING_2D" }]);
    expect(plan!.items.map((item) => item.label)).toEqual(["Slides", "AV needs"]);
  });

  it("honors dueAtOverride in both directions", () => {
    const pulledIn = planSpeakerReminder(
      {
        portal: LIVE_PORTAL,
        assignments: [
          assignment({
            assignmentId: "a-1",
            dueAtOverride: inDays(1),
            requirement: { dueAt: inDays(30), label: "Slides", kind: "file" },
          }),
        ],
      },
      NOW,
    );
    expect(pulledIn!.newStages).toEqual([{ assignmentId: "a-1", stage: "UPCOMING_2D" }]);

    const pushedOut = planSpeakerReminder(
      {
        portal: LIVE_PORTAL,
        assignments: [
          assignment({
            assignmentId: "a-1",
            dueAtOverride: inDays(30),
            requirement: { dueAt: inDays(1), label: "Slides", kind: "file" },
          }),
        ],
      },
      NOW,
    );
    expect(pushedOut).toBeNull();
  });

  it("flags overdue items and reports them for the subject line", () => {
    const plan = planSpeakerReminder(
      {
        portal: LIVE_PORTAL,
        assignments: [
          assignment({
            assignmentId: "a-late",
            requirement: { dueAt: inDays(-3), label: "Slides", kind: "file" },
          }),
        ],
      },
      NOW,
    );
    expect(plan!.newStages).toEqual([{ assignmentId: "a-late", stage: "OVERDUE" }]);
    expect(plan!.items[0]!.late).toBe(true);
    expect(plan!.anyOverdue).toBe(true);
  });
});

describe("planSpeakerReminder — what stays quiet (ER5)", () => {
  const SETTLED: StoredReadinessStatus[] = ["READY", "WAIVED", "NOT_APPLICABLE"];
  const OPEN: StoredReadinessStatus[] = [
    "NOT_STARTED",
    "IN_PROGRESS",
    "SUBMITTED",
    "NEEDS_REVIEW",
  ];

  it("skips settled work and reminds on every open status", () => {
    for (const status of SETTLED) {
      expect(
        planSpeakerReminder(
          { portal: LIVE_PORTAL, assignments: [assignment({ assignmentId: "a-1", status })] },
          NOW,
        ),
        `${status} due tomorrow`,
      ).toBeNull();
    }
    for (const status of OPEN) {
      expect(
        planSpeakerReminder(
          { portal: LIVE_PORTAL, assignments: [assignment({ assignmentId: "a-1", status })] },
          NOW,
        ),
        `${status} due tomorrow`,
      ).not.toBeNull();
    }
  });

  it("never mentions organizer-only requirements", () => {
    const plan = planSpeakerReminder(
      {
        portal: LIVE_PORTAL,
        assignments: [
          assignment({
            assignmentId: "a-internal",
            requirement: { dueAt: inDays(1), label: "AV booked", kind: "internal_checklist" },
          }),
        ],
      },
      NOW,
    );
    expect(plan).toBeNull();

    const withPresenterItem = planSpeakerReminder(
      {
        portal: LIVE_PORTAL,
        assignments: [
          assignment({
            assignmentId: "a-internal",
            requirement: { dueAt: inDays(1), label: "AV booked", kind: "internal_checklist" },
          }),
          assignment({ assignmentId: "a-slides" }),
        ],
      },
      NOW,
    );
    expect(withPresenterItem!.items.map((item) => item.label)).toEqual(["Slides"]);
  });

  it("no live portal, no reminder — never invited, revoked, or expired", () => {
    const assignments = [assignment({ assignmentId: "a-1" })];
    expect(planSpeakerReminder({ portal: null, assignments }, NOW)).toBeNull();
    expect(
      planSpeakerReminder(
        { portal: { expiresAt: inDays(20), revokedAt: inDays(-1) }, assignments },
        NOW,
      ),
    ).toBeNull();
    expect(
      planSpeakerReminder(
        { portal: { expiresAt: inDays(-1), revokedAt: null }, assignments },
        NOW,
      ),
    ).toBeNull();
  });

  it("a stage already in the ledger never fires again", () => {
    const sent: ReadinessReminderStage[] = ["UPCOMING_2D"];
    expect(
      planSpeakerReminder(
        {
          portal: LIVE_PORTAL,
          assignments: [assignment({ assignmentId: "a-1", sentStages: sent })],
        },
        NOW,
      ),
    ).toBeNull();
  });

  it("does not resend an earlier stage that was missed while the window passed", () => {
    // Due in 1 day, 7-day reminder already sent: the current stage is 2 days,
    // which fires. The 7-day stage is spent and is never revisited.
    const plan = planSpeakerReminder(
      {
        portal: LIVE_PORTAL,
        assignments: [assignment({ assignmentId: "a-1", sentStages: ["UPCOMING_7D"] })],
      },
      NOW,
    );
    expect(plan!.newStages).toEqual([{ assignmentId: "a-1", stage: "UPCOMING_2D" }]);
  });

  it("OVERDUE still fires once after the due date, even when both upcoming stages were sent", () => {
    const plan = planSpeakerReminder(
      {
        portal: LIVE_PORTAL,
        assignments: [
          assignment({
            assignmentId: "a-1",
            requirement: { dueAt: inDays(-1), label: "Slides", kind: "file" },
            sentStages: ["UPCOMING_7D", "UPCOMING_2D"],
          }),
        ],
      },
      NOW,
    );
    expect(plan!.newStages).toEqual([{ assignmentId: "a-1", stage: "OVERDUE" }]);

    // And once OVERDUE is spent, an overdue item goes quiet forever.
    expect(
      planSpeakerReminder(
        {
          portal: LIVE_PORTAL,
          assignments: [
            assignment({
              assignmentId: "a-1",
              requirement: { dueAt: inDays(-1), label: "Slides", kind: "file" },
              sentStages: ["UPCOMING_7D", "UPCOMING_2D", "OVERDUE"],
            }),
          ],
        },
        NOW,
      ),
    ).toBeNull();
  });

  it("is deterministic and does not mutate its input", () => {
    const assignments = [
      assignment({ assignmentId: "a-1" }),
      assignment({
        assignmentId: "a-2",
        requirement: { dueAt: inDays(-2), label: "Bio", kind: "short_text" },
        sentStages: ["UPCOMING_7D"],
      }),
    ];
    const snapshot = JSON.parse(JSON.stringify(assignments));
    const first = planSpeakerReminder({ portal: LIVE_PORTAL, assignments }, NOW);
    const second = planSpeakerReminder({ portal: LIVE_PORTAL, assignments }, NOW);
    expect(second).toEqual(first);
    expect(JSON.parse(JSON.stringify(assignments))).toEqual(snapshot);
  });
});
