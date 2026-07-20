/**
 * Background job: certificates.batch_issue
 */

import { z } from "zod";
import { prisma } from "../db";
import { enqueueJob, registerJobHandler } from "../jobs";
import { listEligibleUserIds } from "./eligibility";
import {
  issueCertificateForUser,
  markCertificateReadyEmailSent,
  wasCertificateReadyEmailSent,
} from "./issue";
import { sendCertificateReadyEmail } from "../mail";

export const CERTIFICATES_BATCH_ISSUE_JOB = "certificates.batch_issue";

/** Concurrent PDF render + storage put + upsert workers (keeps memory flat). */
const BATCH_CONCURRENCY = 10;
/** Progress DB writes — every N completions (and always on the last). */
const PROGRESS_EVERY = 10;

const payloadSchema = z.object({
  certificateTemplateId: z.string().min(1),
  sendReadyEmail: z.boolean().optional().default(false),
});

export async function enqueueCertificateBatchIssue(input: {
  certificateTemplateId: string;
  organizationId: string;
  eventId: string;
  createdById: string;
  sendReadyEmail?: boolean;
}): Promise<{ id: string }> {
  return enqueueJob({
    type: CERTIFICATES_BATCH_ISSUE_JOB,
    organizationId: input.organizationId,
    eventId: input.eventId,
    createdById: input.createdById,
    payload: {
      certificateTemplateId: input.certificateTemplateId,
      sendReadyEmail: Boolean(input.sendReadyEmail),
    },
  });
}

/**
 * Run `worker` over `items` with at most `concurrency` in flight.
 * Does not accumulate results — keeps memory flat for large batches.
 */
export async function mapPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (!items.length) return;
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let next = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      await worker(items[i]!, i);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
}

export function registerCertificateJobs(): void {
  registerJobHandler(CERTIFICATES_BATCH_ISSUE_JOB, async (job) => {
    const parsed = payloadSchema.safeParse(job.input);
    if (!parsed.success) throw new Error("Invalid certificates.batch_issue payload");

    const template = await prisma.certificateTemplate.findFirst({
      where: {
        id: parsed.data.certificateTemplateId,
        ...(job.eventId ? { eventId: job.eventId } : {}),
        ...(job.organizationId ? { organizationId: job.organizationId } : {}),
      },
      include: {
        event: {
          select: {
            id: true,
            name: true,
            startDate: true,
            endDate: true,
            timezone: true,
            organizationId: true,
          },
        },
      },
    });
    if (!template) throw new Error("Certificate template not found");

    const eligibleIds = await listEligibleUserIds(template);
    const total = eligibleIds.length;
    let issued = 0;
    let regenerated = 0;
    let emailsSent = 0;
    let completed = 0;
    let lastWritten = 0;
    /** Serialize progress writes so concurrent workers cannot regress the percentage. */
    let progressChain: Promise<void> = Promise.resolve();

    await job.updateProgress(0, `Issuing 0 of ${total}`);

    // One bulk user load — avoids N findUnique round-trips before the pool.
    const users = await prisma.user.findMany({
      where: { id: { in: eligibleIds } },
      select: { id: true, name: true, email: true },
    });
    const userById = new Map(users.map((u) => [u.id, u]));

    const scheduleProgress = (force = false): Promise<void> => {
      progressChain = progressChain.then(async () => {
        const at = completed;
        const should =
          force || at === total || at === 1 || at - lastWritten >= PROGRESS_EVERY;
        if (!should) return;
        if (at < lastWritten && !force) return;
        lastWritten = Math.max(lastWritten, at);
        const pct = Math.round((at / Math.max(total, 1)) * 100);
        await job.updateProgress(pct, `Issued ${at} of ${total}`);
      });
      return progressChain;
    };

    await mapPool(eligibleIds, BATCH_CONCURRENCY, async (userId) => {
      const user = userById.get(userId);
      if (!user) {
        completed += 1;
        await scheduleProgress();
        return;
      }

      const result = await issueCertificateForUser({
        template,
        user,
        issuedByUserId: job.createdById,
        batchJobId: job.id,
        skipEligibilityCheck: true,
      });

      if (result) {
        if (result.created) issued += 1;
        if (result.regenerated) regenerated += 1;

        if (parsed.data.sendReadyEmail && result.created) {
          const already = await wasCertificateReadyEmailSent(result.id);
          if (!already) {
            // Soft rate limit across the pool: brief pause every 20 emails.
            if (emailsSent > 0 && emailsSent % 20 === 0) {
              await new Promise((r) => setTimeout(r, 250));
            }
            await sendCertificateReadyEmail({
              to: user.email,
              name: user.name,
              eventName: template.event.name,
              certificateId: result.publicId,
            });
            await markCertificateReadyEmailSent({
              issuedCertificateId: result.id,
              organizationId: template.organizationId,
              eventId: template.eventId,
            });
            emailsSent += 1;
          }
        }
      }

      completed += 1;
      await scheduleProgress();
    });

    await scheduleProgress(true);

    return {
      issued,
      regenerated,
      skippedIneligible: 0,
      totalEligible: total,
      emailsSent,
    };
  });
}
