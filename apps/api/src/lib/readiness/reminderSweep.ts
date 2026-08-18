import { EventStatus, ReadinessAssignmentStatus } from "@prisma/client";
import { writeAuditLog } from "../ai";
import { prisma } from "../db";
import { withDbRetry } from "../dbRetry";
import { getEmailProvider } from "../email";
import { featureEnabled } from "../features";
import { log } from "../log";
import { sendReadinessReminderEmail } from "../mail";
import { mintReminderPortalUrl } from "./portal";
import {
  planSpeakerReminder,
  type ReadinessReminderStage,
  type ReminderAssignment,
} from "./reminderStages";

/**
 * ER5 — periodic sweep that emails presenters about materials that are nearly
 * due (7 days, then 2 days) and once when a due date has passed.
 *
 * The calm rules, and where each one is enforced:
 * - AT MOST ONCE per (assignment, stage): the ReadinessReminderSend ledger's
 *   unique constraint. Rows are claimed BEFORE the send, so a crash or a second
 *   process cannot produce a duplicate; a send that throws releases its claim so
 *   the next tick retries.
 * - ONE email per presenter per run, listing everything still open — not one
 *   email per requirement (planSpeakerReminder does the aggregation).
 * - A presenter with nothing newly due gets nothing at all. No email means no
 *   ledger row, no audit row, and no portal token churn.
 *
 * Stage derivation itself is pure and unit-tested in reminderStages.ts; this
 * module is only the I/O around it.
 */

const OPEN_STATUSES: ReadinessAssignmentStatus[] = [
  ReadinessAssignmentStatus.NOT_STARTED,
  ReadinessAssignmentStatus.IN_PROGRESS,
  ReadinessAssignmentStatus.SUBMITTED,
  ReadinessAssignmentStatus.NEEDS_REVIEW,
];

export type ReminderSweepResult = {
  /** Presenters emailed (one email each). */
  sent: number;
  /** Ledger rows written — the (assignment, stage) pairs that fired. */
  stagesRecorded: number;
  /** Set when the sweep declined to run at all, so callers can log honestly. */
  skipped?: "email_not_configured";
};

/**
 * Events that can produce reminders: they have open presenter assignments, are
 * not archived, have not finished, and have readiness enabled. DRAFT events
 * count — presenters are chased for materials long before the agenda is
 * published, which is the whole point of the feature.
 */
async function reminderEligibleEventIds(now: Date): Promise<string[]> {
  const candidates = await withDbRetry(() =>
    prisma.readinessAssignment.findMany({
      where: {
        speakerId: { not: null },
        status: { in: OPEN_STATUSES },
        event: { status: { not: EventStatus.ARCHIVED }, endDate: { gte: now } },
      },
      distinct: ["eventId"],
      select: { eventId: true },
    }),
  );
  const eligible: string[] = [];
  for (const candidate of candidates) {
    if (await featureEnabled(candidate.eventId, "readiness")) eligible.push(candidate.eventId);
  }
  return eligible;
}

export async function sweepReadinessReminders(now = new Date()): Promise<ReminderSweepResult> {
  // Without a mailer there is nothing to send and no stage worth spending: an
  // unconfigured environment must not burn the ledger on emails nobody gets.
  if (!getEmailProvider().isConfigured()) {
    return { sent: 0, stagesRecorded: 0, skipped: "email_not_configured" };
  }

  const eventIds = await reminderEligibleEventIds(now);
  let sent = 0;
  let stagesRecorded = 0;

  for (const eventId of eventIds) {
    try {
      const result = await remindEvent(eventId, now);
      sent += result.sent;
      stagesRecorded += result.stagesRecorded;
    } catch (err) {
      log("warn", "sweepReadinessReminders: event failed", {
        eventId,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { sent, stagesRecorded };
}

async function remindEvent(
  eventId: string,
  now: Date,
): Promise<{ sent: number; stagesRecorded: number }> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, name: true, timezone: true, organizationId: true },
  });
  if (!event) return { sent: 0, stagesRecorded: 0 };

  const assignments = await prisma.readinessAssignment.findMany({
    where: { eventId, speakerId: { not: null }, status: { in: OPEN_STATUSES } },
    select: {
      id: true,
      speakerId: true,
      status: true,
      dueAtOverride: true,
      requirement: { select: { label: true, kind: true, dueAt: true } },
    },
  });
  if (assignments.length === 0) return { sent: 0, stagesRecorded: 0 };

  const speakerIds = [
    ...new Set(assignments.map((a) => a.speakerId).filter((id): id is string => Boolean(id))),
  ];
  const [accesses, ledger] = await Promise.all([
    prisma.readinessPortalAccess.findMany({
      where: { eventId, speakerId: { in: speakerIds } },
      select: {
        id: true,
        speakerId: true,
        email: true,
        expiresAt: true,
        revokedAt: true,
        speaker: { select: { name: true } },
      },
    }),
    prisma.readinessReminderSend.findMany({
      where: { assignmentId: { in: assignments.map((a) => a.id) } },
      select: { assignmentId: true, stage: true },
    }),
  ]);

  const accessBySpeaker = new Map(accesses.map((access) => [access.speakerId, access]));
  const sentStagesByAssignment = new Map<string, ReadinessReminderStage[]>();
  for (const row of ledger) {
    const stages = sentStagesByAssignment.get(row.assignmentId) ?? [];
    stages.push(row.stage);
    sentStagesByAssignment.set(row.assignmentId, stages);
  }

  const bySpeaker = new Map<string, ReminderAssignment[]>();
  for (const assignment of assignments) {
    if (!assignment.speakerId) continue;
    const forSpeaker = bySpeaker.get(assignment.speakerId) ?? [];
    forSpeaker.push({
      assignmentId: assignment.id,
      status: assignment.status,
      dueAtOverride: assignment.dueAtOverride,
      requirement: assignment.requirement,
      sentStages: sentStagesByAssignment.get(assignment.id) ?? [],
    });
    bySpeaker.set(assignment.speakerId, forSpeaker);
  }

  let sent = 0;
  let stagesRecorded = 0;

  for (const [speakerId, speakerAssignments] of bySpeaker) {
    const access = accessBySpeaker.get(speakerId) ?? null;
    const plan = planSpeakerReminder(
      { portal: access, assignments: speakerAssignments },
      now,
    );
    if (!plan || !access) continue;

    // Claim first: skipDuplicates means a concurrent sweep that already claimed
    // these stages leaves us with nothing to send, which is the correct answer.
    const claimed = await prisma.readinessReminderSend.createMany({
      data: plan.newStages.map((entry) => ({
        eventId,
        speakerId,
        assignmentId: entry.assignmentId,
        stage: entry.stage,
        sentAt: now,
      })),
      skipDuplicates: true,
    });
    if (claimed.count === 0) continue;

    const releaseClaim = () =>
      prisma.readinessReminderSend
        .deleteMany({
          where: {
            OR: plan.newStages.map((entry) => ({
              assignmentId: entry.assignmentId,
              stage: entry.stage,
            })),
            sentAt: now,
          },
        })
        .catch(() => undefined);

    const portalLink = await mintReminderPortalUrl(access.id, now);
    if (!portalLink) {
      await releaseClaim();
      continue;
    }

    try {
      const mail = await sendReadinessReminderEmail({
        to: access.email,
        speakerName: access.speaker.name,
        eventName: event.name,
        portalUrl: portalLink,
        items: plan.items.map((item) => ({
          label: item.label,
          dueAt: item.dueAt,
          late: item.late,
        })),
        timeZone: event.timezone,
      });

      await writeAuditLog({
        organizationId: event.organizationId,
        eventId,
        actorUserId: null,
        action: "OTHER",
        entityType: "ReadinessPortalAccess",
        entityId: access.id,
        payload: {
          action: "reminder",
          system: true,
          speakerId,
          stages: plan.newStages.map((entry) => entry.stage),
          itemCount: plan.items.length,
          overdue: plan.anyOverdue,
          delivered: mail.delivered,
        },
      });

      sent += 1;
      stagesRecorded += claimed.count;
    } catch (err) {
      await releaseClaim();
      log("warn", "sweepReadinessReminders: send failed", {
        eventId,
        speakerId,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { sent, stagesRecorded };
}
