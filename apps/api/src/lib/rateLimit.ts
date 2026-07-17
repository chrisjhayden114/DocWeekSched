import type { Request, Response, NextFunction } from "express";

type Bucket = { count: number; resetAt: number; failures: number; blockedUntil: number };

const buckets = new Map<string, Bucket>();

function clientIp(req: Request): string {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length > 0) return xf.split(",")[0]!.trim();
  return req.ip || req.socket.remoteAddress || "unknown";
}

/**
 * Sliding-window rate limit: 5 requests / minute / IP, with exponential backoff after failures.
 */
export function authRateLimit(opts?: { windowMs?: number; max?: number }) {
  const windowMs = opts?.windowMs ?? 60_000;
  const max = opts?.max ?? 5;

  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${clientIp(req)}:${req.path}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs, failures: bucket?.failures ?? 0, blockedUntil: bucket?.blockedUntil ?? 0 };
      buckets.set(key, bucket);
    }

    if (now < bucket.blockedUntil) {
      const retryAfter = Math.ceil((bucket.blockedUntil - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({ error: "Too many requests. Try again later." });
    }

    bucket.count += 1;
    if (bucket.count > max) {
      const backoffMs = Math.min(15 * 60_000, 30_000 * Math.max(1, bucket.failures));
      bucket.failures += 1;
      bucket.blockedUntil = now + backoffMs;
      const retryAfter = Math.ceil(backoffMs / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({ error: "Too many requests. Try again later." });
    }

    return next();
  };
}

export function noteAuthFailure(req: Request): void {
  const key = `${clientIp(req)}:${req.path}`;
  const bucket = buckets.get(key);
  if (!bucket) return;
  bucket.failures += 1;
  const backoffMs = Math.min(15 * 60_000, 5_000 * bucket.failures);
  bucket.blockedUntil = Math.max(bucket.blockedUntil, Date.now() + backoffMs);
}

export function clearAuthFailures(req: Request): void {
  const key = `${clientIp(req)}:${req.path}`;
  const bucket = buckets.get(key);
  if (bucket) {
    bucket.failures = 0;
    bucket.blockedUntil = 0;
  }
}

/** Test helper */
export function _resetRateLimitBucketsForTests(): void {
  buckets.clear();
}
