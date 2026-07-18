import { prisma } from "../../db";
import { featureEnabled } from "../../features";
import { enqueueJob, registerJobHandler } from "../../jobs";
import { runMatchBatch, weeklyBatchKey } from "./batch";

export const MATCHMAKER_JOIN_JOB = "ai.matchmaker_join";
export const MATCHMAKER_WEEKLY_JOB = "ai.matchmaker_weekly";
export const MATCHMAKER_WEEKLY_SWEEP_JOB = "ai.matchmaker_weekly_sweep";

export async function maybeEnqueueJoinMatch(input: {
  eventId: string;
  organizationId: string;
  userId: string;
}): Promise<{ enqueued: boolean; jobId?: string }> {
  if (!(await featureEnabled(input.eventId, "matchmaker"))) {
    return { enqueued: false };
  }
  const m = await prisma.eventMembership.findFirst({
    where: { eventId: input.eventId, userId: input.userId, deletedAt: null },
    select: { directoryOptIn: true, matchMeEnabled: true },
  });
  if (!m?.directoryOptIn || !m.matchMeEnabled) {
    return { enqueued: false };
  }
  const job = await enqueueJob({
    type: MATCHMAKER_JOIN_JOB,
    organizationId: input.organizationId,
    eventId: input.eventId,
    createdById: input.userId,
    payload: { userId: input.userId, batchKey: "join" },
  });
  return { enqueued: true, jobId: job.id };
}

export async function enqueueWeeklyMatchForEvent(eventId: string): Promise<number> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, organizationId: true, startDate: true, endDate: true },
  });
  if (!event) return 0;
  if (!(await featureEnabled(eventId, "matchmaker"))) return 0;

  const now = new Date();
  // Weekly during event window (from 7 days before start through end)
  const windowStart = new Date(event.startDate.getTime() - 7 * 86_400_000);
  if (now < windowStart || now > event.endDate) return 0;

  const batchKey = weeklyBatchKey(now);
  const members = await prisma.eventMembership.findMany({
    where: {
      eventId,
      deletedAt: null,
      directoryOptIn: true,
      matchMeEnabled: true,
    },
    select: { userId: true },
  });

  let n = 0;
  for (const m of members) {
    await enqueueJob({
      type: MATCHMAKER_WEEKLY_JOB,
      organizationId: event.organizationId,
      eventId,
      createdById: m.userId,
      payload: { userId: m.userId, batchKey },
    });
    n += 1;
  }
  return n;
}

let registered = false;

export function registerMatchmakerJobs(): void {
  if (registered) return;
  registered = true;

  registerJobHandler(MATCHMAKER_JOIN_JOB, async (job) => {
    const payload = (job.input || {}) as { userId?: string; batchKey?: string };
    if (!job.eventId || !job.organizationId || !payload.userId) {
      throw new Error("matchmaker join job missing event/org/user");
    }
    await job.updateProgress(10, "Matching…");
    const result = await runMatchBatch({
      eventId: job.eventId,
      organizationId: job.organizationId,
      forUserId: payload.userId,
      batchKey: payload.batchKey || "join",
      deliverNotification: true,
      includeMeetingSlots: true,
    });
    await job.updateProgress(100, "Done");
    return { skipped: result.skipped, reason: result.reason, count: result.suggestions.length };
  });

  registerJobHandler(MATCHMAKER_WEEKLY_JOB, async (job) => {
    const payload = (job.input || {}) as { userId?: string; batchKey?: string };
    if (!job.eventId || !job.organizationId || !payload.userId) {
      throw new Error("matchmaker weekly job missing event/org/user");
    }
    await job.updateProgress(10, "Weekly matches…");
    const result = await runMatchBatch({
      eventId: job.eventId,
      organizationId: job.organizationId,
      forUserId: payload.userId,
      batchKey: payload.batchKey || weeklyBatchKey(),
      deliverNotification: true,
      includeMeetingSlots: true,
    });
    await job.updateProgress(100, "Done");
    return { skipped: result.skipped, reason: result.reason, count: result.suggestions.length };
  });

  registerJobHandler(MATCHMAKER_WEEKLY_SWEEP_JOB, async (job) => {
    await job.updateProgress(5, "Sweeping events…");
    const now = new Date();
    const events = await prisma.event.findMany({
      where: {
        status: "ACTIVE",
        endDate: { gte: now },
        startDate: { lte: new Date(now.getTime() + 7 * 86_400_000) },
      },
      select: { id: true },
      take: 50,
    });
    let total = 0;
    for (const e of events) {
      total += await enqueueWeeklyMatchForEvent(e.id);
    }
    await job.updateProgress(100, `Enqueued ${total}`);
    return { events: events.length, enqueued: total };
  });
}
