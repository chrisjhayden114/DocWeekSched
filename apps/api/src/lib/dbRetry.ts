/**
 * HARDEN-2 — retry only connection-class Prisma failures.
 *
 * A brief Neon/Postgres blip used to surface as PrismaClientKnownRequestError
 * bursts from the job poller and notification sweeps. Those are infrastructure,
 * not caller bugs: retry a handful of times with exponential backoff. Every
 * other Prisma error (unique violation, not found, …) is rethrown immediately.
 *
 * The retry predicate is prismaConnectionDropCode in sentry.ts — one matcher
 * for Sentry grouping and for this wrapper.
 */

import { prismaConnectionDropCode } from "./sentry";

export type DbRetryOptions = {
  /** Total attempts, including the first. Default 3. */
  retries?: number;
  /** Delay before the first retry. Doubles each attempt, plus jitter. Default 250. */
  baseDelayMs?: number;
};

const DEFAULT_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Backoff: base * 2^attempt, plus 0–100% jitter so concurrent sweepers don't sync. */
export function dbRetryDelayMs(baseDelayMs: number, attemptIndex: number, jitter = Math.random()): number {
  const exp = baseDelayMs * 2 ** attemptIndex;
  return Math.round(exp + exp * jitter);
}

export async function withDbRetry<T>(fn: () => Promise<T>, opts?: DbRetryOptions): Promise<T> {
  const retries = opts?.retries ?? DEFAULT_RETRIES;
  const baseDelayMs = opts?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!prismaConnectionDropCode(err) || attempt >= retries) {
        throw err;
      }
      const delay = dbRetryDelayMs(baseDelayMs, attempt - 1);
      if (delay > 0) await sleep(delay);
    }
  }
  throw lastErr;
}
