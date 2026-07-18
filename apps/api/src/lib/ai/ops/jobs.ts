import { prisma } from "../../db";
import { featureEnabled } from "../../features/featureEnabled";
import { enqueueJob, registerJobHandler } from "../../jobs";
import { runOpsDetectorsForEvent } from "./detectors";
import { isOpsInboxActive } from "./window";
import { OPS_DETECT_EVENT_JOB, OPS_DETECT_SWEEP_JOB } from "./types";

export { OPS_DETECT_EVENT_JOB, OPS_DETECT_SWEEP_JOB };

export async function enqueueOpsDetectForEvent(input: {
  eventId: string;
  organizationId: string;
  createdById?: string | null;
}): Promise<{ enqueued: boolean; jobId?: string }> {
  if (!(await featureEnabled(input.eventId, "ops_agent"))) {
    return { enqueued: false };
  }
  const job = await enqueueJob({
    type: OPS_DETECT_EVENT_JOB,
    organizationId: input.organizationId,
    eventId: input.eventId,
    createdById: input.createdById || undefined,
    payload: {},
  });
  return { enqueued: true, jobId: job.id };
}

/** Sweep ACTIVE events in the ops window and enqueue per-event detector jobs. */
export async function enqueueOpsDetectSweep(createdById?: string | null): Promise<number> {
  const now = new Date();
  const events = await prisma.event.findMany({
    where: {
      status: "ACTIVE",
      // Broad filter; isOpsInboxActive narrows precisely.
      startDate: { lte: new Date(now.getTime() + 48 * 60 * 60 * 1000) },
      endDate: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
    },
    select: { id: true, organizationId: true, startDate: true, endDate: true },
    take: 100,
  });

  let n = 0;
  for (const e of events) {
    if (!isOpsInboxActive(e, now)) continue;
    if (!(await featureEnabled(e.id, "ops_agent"))) continue;
    await enqueueJob({
      type: OPS_DETECT_EVENT_JOB,
      organizationId: e.organizationId,
      eventId: e.id,
      createdById: createdById || undefined,
      payload: {},
    });
    n += 1;
  }
  return n;
}

let registered = false;

export function registerOpsJobs(): void {
  if (registered) return;
  registered = true;

  registerJobHandler(OPS_DETECT_EVENT_JOB, async (job) => {
    if (!job.eventId) throw new Error("ops detect event job missing eventId");
    await job.updateProgress(10, "Running detectors…");
    const result = await runOpsDetectorsForEvent(job.eventId, { jobId: job.id });
    await job.updateProgress(100, `Created ${result.createdTotal} cards`);
    return {
      active: result.active,
      createdTotal: result.createdTotal,
      results: result.results,
    };
  });

  registerJobHandler(OPS_DETECT_SWEEP_JOB, async (job) => {
    await job.updateProgress(5, "Sweeping ops window…");
    const enqueued = await enqueueOpsDetectSweep(job.createdById);
    await job.updateProgress(100, `Enqueued ${enqueued}`);
    return { enqueued };
  });
}
