import { BackgroundJobStatus, type Prisma } from "@prisma/client";
import { prisma } from "../db";
import { writeAuditLog } from "../ai/audit";

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
    await prisma.backgroundJob.update({
      where: { id: jobId },
      data: {
        status: dead ? BackgroundJobStatus.DEAD : BackgroundJobStatus.FAILED,
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

export function startJobPoller(intervalMs = Number(process.env.JOB_POLL_INTERVAL_MS || 5000)): void {
  if (pollerStarted) return;
  pollerStarted = true;
  setInterval(() => {
    void processDueJobs().catch((err) => console.error("[jobs] processDueJobs", err));
  }, intervalMs);
}
