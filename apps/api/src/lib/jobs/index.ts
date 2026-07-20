import { BackgroundJobStatus, type Prisma } from "@prisma/client";
import { prisma } from "../db";
import { writeAuditLog } from "../ai/audit";
import { log } from "../log";
import { captureException } from "../sentry";

export type JobHandler = (job: {
  id: string;
  type: string;
  input: unknown;
  organizationId: string | null;
  eventId: string | null;
  createdById: string | null;
  updateProgress: (progress: number, message?: string) => Promise<void>;
}) => Promise<Prisma.InputJsonValue | void>;

const handlers = new Map<string, JobHandler>();

export function registerJobHandler(type: string, handler: JobHandler): void {
  handlers.set(type, handler);
}

export async function enqueueJob(input: {
  type: string;
  organizationId?: string | null;
  eventId?: string | null;
  createdById?: string | null;
  payload?: Prisma.InputJsonValue;
  maxAttempts?: number;
  /** When the job becomes eligible (defaults to now). */
  scheduledAt?: Date;
}): Promise<{ id: string }> {
  const row = await prisma.backgroundJob.create({
    data: {
      type: input.type,
      organizationId: input.organizationId ?? null,
      eventId: input.eventId ?? null,
      createdById: input.createdById ?? null,
      input: input.payload ?? {},
      maxAttempts: input.maxAttempts ?? 3,
      status: BackgroundJobStatus.PENDING,
      ...(input.scheduledAt ? { scheduledAt: input.scheduledAt } : {}),
    },
  });
  await writeAuditLog({
    organizationId: input.organizationId,
    eventId: input.eventId,
    actorUserId: input.createdById,
    action: "JOB_ENQUEUE",
    entityType: "background_job",
    entityId: row.id,
    aiGenerated: false,
    payload: { type: input.type },
  });
  return { id: row.id };
}

export async function getJob(id: string) {
  return prisma.backgroundJob.findUnique({ where: { id } });
}

export async function processDueJobs(limit = 5): Promise<number> {
  const candidates = await prisma.backgroundJob.findMany({
    where: {
      OR: [
        { status: BackgroundJobStatus.PENDING, scheduledAt: { lte: new Date() } },
        { status: BackgroundJobStatus.FAILED, scheduledAt: { lte: new Date() } },
      ],
    },
    orderBy: { scheduledAt: "asc" },
    take: limit * 3,
  });

  let processed = 0;
  for (const job of candidates) {
    if (job.attempts >= job.maxAttempts) {
      if (job.status !== BackgroundJobStatus.DEAD) {
        await prisma.backgroundJob.update({
          where: { id: job.id },
          data: { status: BackgroundJobStatus.DEAD, finishedAt: new Date() },
        });
      }
      continue;
    }
    if (processed >= limit) break;
    await runOne(job.id);
    processed += 1;
  }
  return processed;
}

async function runOne(jobId: string): Promise<void> {
  const job = await prisma.backgroundJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  if (job.attempts >= job.maxAttempts) {
    await prisma.backgroundJob.update({
      where: { id: jobId },
      data: { status: BackgroundJobStatus.DEAD, finishedAt: new Date() },
    });
    return;
  }

  const handler = handlers.get(job.type);
  await prisma.backgroundJob.update({
    where: { id: jobId },
    data: {
      status: BackgroundJobStatus.RUNNING,
      startedAt: new Date(),
      attempts: { increment: 1 },
      progress: 0,
      error: null,
    },
  });

  const updateProgress = async (progress: number, message?: string) => {
    await prisma.backgroundJob.update({
      where: { id: jobId },
      data: {
        progress: Math.max(0, Math.min(100, Math.round(progress))),
        progressMessage: message ?? null,
      },
    });
  };

  if (!handler) {
    await prisma.backgroundJob.update({
      where: { id: jobId },
      data: {
        status: BackgroundJobStatus.FAILED,
        error: `No handler registered for job type: ${job.type}`,
        finishedAt: new Date(),
        scheduledAt: new Date(Date.now() + 60_000),
      },
    });
    return;
  }

  try {
    const result = await handler({
      id: job.id,
      type: job.type,
      input: job.input,
      organizationId: job.organizationId,
      eventId: job.eventId,
      createdById: job.createdById,
      updateProgress,
    });
    await prisma.backgroundJob.update({
      where: { id: jobId },
      data: {
        status: BackgroundJobStatus.SUCCEEDED,
        progress: 100,
        ...(result !== undefined ? { result } : {}),
        finishedAt: new Date(),
        progressMessage: "Done",
      },
    });
    await writeAuditLog({
      organizationId: job.organizationId,
      eventId: job.eventId,
      actorUserId: job.createdById,
      action: "JOB_COMPLETE",
      entityType: "background_job",
      entityId: jobId,
      payload: { type: job.type },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Job failed";
    const nextAttempts = job.attempts + 1;
    const dead = nextAttempts >= job.maxAttempts;
    log("error", "background job failed", {
      jobId,
      type: job.type,
      detail: message,
      dead,
    });
    captureException(err, { tags: { jobType: job.type, jobId }, extra: { dead } });
    await prisma.backgroundJob.update({
      where: { id: jobId },
      data: {
        status: dead ? BackgroundJobStatus.DEAD : BackgroundJobStatus.FAILED,
        // Stored for ops/audit; GET /jobs/:id never echoes this raw string to clients.
        error: message,
        finishedAt: dead ? new Date() : null,
        ...(dead ? {} : { scheduledAt: new Date(Date.now() + 30_000) }),
      },
    });
    await writeAuditLog({
      organizationId: job.organizationId,
      eventId: job.eventId,
      actorUserId: job.createdById,
      action: "JOB_FAIL",
      entityType: "background_job",
      entityId: jobId,
      payload: { type: job.type, error: message, dead },
    });
  }
}

let pollerStarted = false;
/** Last time the poller tick finished (success or caught failure). */
let lastPollerHeartbeatAt: number | null = null;

/** Milliseconds since the last poller tick, or null if the poller has never run. */
export function getJobPollerHeartbeatAgeMs(): number | null {
  if (lastPollerHeartbeatAt == null) return null;
  return Date.now() - lastPollerHeartbeatAt;
}

export function startJobPoller(intervalMs = Number(process.env.JOB_POLL_INTERVAL_MS || 5000)): void {
  if (pollerStarted) return;
  pollerStarted = true;
  // Mark alive at boot so /health/ready isn't falsely 503 for the first interval.
  lastPollerHeartbeatAt = Date.now();
  setInterval(() => {
    void processDueJobs()
      .catch((err) => {
        log("error", "processDueJobs tick failed", {
          detail: err instanceof Error ? err.message : String(err),
        });
        captureException(err, { tags: { area: "job_poller" } });
      })
      .finally(() => {
        lastPollerHeartbeatAt = Date.now();
      });
  }, intervalMs);
}

/** Test helper — mark the poller as recently healthy without starting the interval. */
export function _markJobPollerHeartbeatForTests(at = Date.now()): void {
  lastPollerHeartbeatAt = at;
}
