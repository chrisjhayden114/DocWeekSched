/**
 * Test-only helpers for draining background jobs (FIX_PLAN chunk E20).
 *
 * Why a plain `while (processDueJobs() > 0)` loop flakes: `BackgroundJob.scheduledAt`
 * defaults to the DATABASE clock (`@default(now())`) while `processDueJobs` filters
 * with the APP clock (`scheduledAt <= new Date()`). A freshly enqueued job can be
 * fractionally "in the future" on the first poll, so a drain that breaks on one
 * empty poll gives up before the work exists. Under parallel suite load (58 files
 * against one branch) other workers also compete for the same job table.
 *
 * These helpers poll until the caller-visible condition holds — sleeping between
 * empty polls — and only give up after a generous timeout, failing with an error
 * that names the drain rather than letting a downstream assertion misfire.
 */

import { BackgroundJobStatus, type PrismaClient } from "@prisma/client";
import { processDueJobs } from "../../lib/jobs";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type DrainOptions = {
  /** Names the drain in the timeout error. */
  label: string;
  /** Generous by design; failed jobs back off 30s (60s for a missing handler). */
  timeoutMs?: number;
  pollIntervalMs?: number;
  batchSize?: number;
};

/**
 * Process due jobs until `settled()` reports the expected side effects exist.
 * `settled` is checked after every poll (not only empty ones) so a shared job
 * table busy with other workers' jobs cannot starve the drain into a timeout.
 * Throws a named error on timeout instead of returning silently.
 */
export async function drainJobsUntil(
  settled: () => Promise<boolean>,
  options: DrainOptions,
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  const batchSize = options.batchSize ?? 5;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const processed = await processDueJobs(batchSize);
    if (await settled()) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `drainJobsUntil(${options.label}): condition not met within ${timeoutMs}ms — ` +
          `jobs may still be scheduled in the future or held by another test worker`,
      );
    }
    if (processed === 0) await sleep(pollIntervalMs);
  }
}

/**
 * Drain until no PENDING/RUNNING/FAILED background jobs remain for the event.
 * (RUNNING covers a parallel test worker holding the job mid-run; FAILED covers
 * retry backoff — both resolve within the timeout or fail loudly.)
 */
export async function drainEventJobs(
  prisma: PrismaClient,
  eventId: string,
  options?: Partial<DrainOptions>,
): Promise<void> {
  await drainJobsUntil(
    async () => {
      const outstanding = await prisma.backgroundJob.count({
        where: {
          eventId,
          status: {
            in: [
              BackgroundJobStatus.PENDING,
              BackgroundJobStatus.RUNNING,
              BackgroundJobStatus.FAILED,
            ],
          },
        },
      });
      return outstanding === 0;
    },
    { label: `event ${eventId} jobs`, ...options },
  );
}
