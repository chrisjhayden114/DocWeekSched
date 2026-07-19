/**
 * Background job: recap.generate
 */

import { z } from "zod";
import { enqueueJob, registerJobHandler } from "../../jobs";
import { generateEventRecap } from "./generate";
import { RecapSectionError } from "./types";

export const RECAP_GENERATE_JOB = "recap.generate";

const payloadSchema = z.object({
  eventId: z.string().min(1),
  organizationId: z.string().min(1),
  createdById: z.string().min(1),
});

export async function enqueueRecapGenerate(input: {
  eventId: string;
  organizationId: string;
  createdById: string;
}): Promise<{ id: string }> {
  return enqueueJob({
    type: RECAP_GENERATE_JOB,
    organizationId: input.organizationId,
    eventId: input.eventId,
    createdById: input.createdById,
    payload: {
      eventId: input.eventId,
      organizationId: input.organizationId,
      createdById: input.createdById,
    },
  });
}

export function registerRecapJobs(): void {
  registerJobHandler(RECAP_GENERATE_JOB, async (job) => {
    const parsed = payloadSchema.safeParse(job.input);
    if (!parsed.success) throw new Error("Invalid recap.generate payload");

    await job.updateProgress(5, "Computing metrics");
    try {
      const result = await generateEventRecap({
        eventId: parsed.data.eventId,
        organizationId: parsed.data.organizationId,
        createdById: parsed.data.createdById,
        jobId: job.id,
      });
      await job.updateProgress(100, result.regenerated ? "Regenerated" : "Ready");
      return { recapId: result.recapId, status: result.status, regenerated: result.regenerated };
    } catch (err) {
      if (err instanceof RecapSectionError) {
        throw new Error(`${err.code}: ${err.message}`);
      }
      throw err;
    }
  });
}
