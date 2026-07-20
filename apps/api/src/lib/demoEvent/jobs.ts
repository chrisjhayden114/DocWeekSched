import { enqueueJob, registerJobHandler } from "../jobs";
import { DEMO_RESET_JOB, resetPublicDemoEvent } from "./reset";

export { DEMO_RESET_JOB };

function nextNightlyUtc(from = new Date()): Date {
  const next = new Date(from);
  next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(3, 0, 0, 0);
  if (next.getTime() <= from.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

export function registerDemoEventJobs(): void {
  registerJobHandler(DEMO_RESET_JOB, async (job) => {
    await job.updateProgress(10, "Resetting public demo event");
    const result = await resetPublicDemoEvent();
    const input = job.input as { reason?: string };
    if (input?.reason === "nightly") {
      await enqueueJob({
        type: DEMO_RESET_JOB,
        payload: { reason: "nightly" },
        scheduledAt: nextNightlyUtc(),
        maxAttempts: 5,
      });
    }
    await job.updateProgress(100, "Demo reset complete");
    return result;
  });
}

/** Enqueue a one-off reset (seed script / manual). */
export async function enqueueDemoReset(createdById?: string | null): Promise<{ id: string }> {
  return enqueueJob({
    type: DEMO_RESET_JOB,
    payload: { reason: "manual" },
    createdById: createdById ?? null,
    maxAttempts: 3,
  });
}

/**
 * Schedule the next nightly reset (~03:00 UTC) if none is already pending for demo.event.reset.
 * Idempotent across process restarts: skips when a future PENDING job of this type exists.
 */
export async function ensureNightlyDemoResetScheduled(): Promise<void> {
  const { prisma } = await import("../db");
  const existing = await prisma.backgroundJob.findFirst({
    where: {
      type: DEMO_RESET_JOB,
      status: { in: ["PENDING", "RUNNING"] },
      scheduledAt: { gt: new Date() },
    },
    select: { id: true },
  });
  if (existing) return;

  await enqueueJob({
    type: DEMO_RESET_JOB,
    payload: { reason: "nightly" },
    scheduledAt: nextNightlyUtc(),
    maxAttempts: 5,
  });
}
