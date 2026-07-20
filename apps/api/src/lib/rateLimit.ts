import { createHash } from "crypto";
import type { Request, Response, NextFunction } from "express";

/**
 * In-memory fixed-window rate limiting with failure backoff.
 *
 * SINGLE-INSTANCE ASSUMPTION (see RUNBOOK.md §7): state lives in this process.
 * Valid while the API runs as exactly one instance; move to a shared store
 * before scaling out.
 */

type Bucket = { count: number; resetAt: number; failures: number; blockedUntil: number };

const buckets = new Map<string, Bucket>();

/** Identifier-keyed (hashed email) failure backoff, independent of client IP. */
type FailureState = { failures: number; blockedUntil: number };
const identifierFailures = new Map<string, FailureState>();

const SWEEP_INTERVAL_MS = 5 * 60_000;
const STALE_GRACE_MS = 15 * 60_000;
let lastSweepAt = 0;

/** Drop buckets whose window, block, and backoff memory are all stale. */
function sweepExpired(now: number): void {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt + STALE_GRACE_MS && now > bucket.blockedUntil) {
      buckets.delete(key);
    }
  }
  for (const [key, state] of identifierFailures) {
    if (now > state.blockedUntil + STALE_GRACE_MS) {
      identifierFailures.delete(key);
    }
  }
}

/**
 * req.ip respects app.set("trust proxy", 1) — exactly one hop (Render's proxy),
 * so it is the address the proxy saw, not a client-forgeable header. Never read
 * X-Forwarded-For directly: clients can append forged entries to mint fresh
 * buckets and bypass limits.
 */
function clientIp(req: Request): string {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

/**
 * Key by route PATTERN ("/verify/:certificateId"), not the concrete path —
 * otherwise every guessed path param gets its own bucket and per-IP limiting
 * does nothing against enumeration.
 */
function routeKey(req: Request, name?: string): string {
  if (name) return name;
  const pattern = (req.route as { path?: string } | undefined)?.path;
  if (typeof pattern === "string") return `${req.baseUrl || ""}${pattern}`;
  return `${req.baseUrl || ""}${req.path}`;
}

function bucketKey(req: Request, opts?: { name?: string; keyBy?: "ip" | "user" }): string {
  const userId = (req as Request & { user?: { id?: string } }).user?.id;
  const subject = opts?.keyBy === "user" && userId ? `u:${userId}` : clientIp(req);
  return `${subject}:${routeKey(req, opts?.name)}`;
}

export type RateLimitOptions = {
  windowMs?: number;
  max?: number;
  /** Explicit bucket name; defaults to the route pattern. */
  name?: string;
  /** "user" keys by authenticated user id (mount AFTER requireAuth); falls back to IP. */
  keyBy?: "ip" | "user";
};

/**
 * Fixed-window rate limit (default 5 requests / minute), with exponential
 * backoff once a window is exceeded or failures are noted.
 */
export function authRateLimit(opts?: RateLimitOptions) {
  const windowMs = opts?.windowMs ?? 60_000;
  const max = opts?.max ?? 5;

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    sweepExpired(now);

    const key = bucketKey(req, opts);
    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = {
        count: 0,
        resetAt: now + windowMs,
        failures: bucket?.failures ?? 0,
        blockedUntil: bucket?.blockedUntil ?? 0,
      };
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

/**
 * Note a failed auth attempt for this IP+route bucket (escalating backoff).
 * Call from the ROUTE HANDLER (req.route is set there, matching the middleware key).
 */
export function noteAuthFailure(req: Request): void {
  const bucket = buckets.get(bucketKey(req));
  if (!bucket) return;
  bucket.failures += 1;
  const backoffMs = Math.min(15 * 60_000, 5_000 * bucket.failures);
  bucket.blockedUntil = Math.max(bucket.blockedUntil, Date.now() + backoffMs);
}

export function clearAuthFailures(req: Request): void {
  const bucket = buckets.get(bucketKey(req));
  if (bucket) {
    bucket.failures = 0;
    bucket.blockedUntil = 0;
  }
}

/** Public read rate limit: 60 / minute / IP (SSR + crawlers). */
export function publicRateLimit(opts?: { windowMs?: number; max?: number }) {
  return authRateLimit({ windowMs: opts?.windowMs ?? 60_000, max: opts?.max ?? 60 });
}

/** Hash identifiers (emails) before using them as in-memory keys — never hold PII. */
function identifierKey(identifier: string): string {
  return createHash("sha256").update(identifier.trim().toLowerCase()).digest("hex");
}

/**
 * Per-identifier (hashed email) backoff for login: attempts spread across many
 * IPs still escalate, because the key ignores the client address entirely.
 */
export function noteIdentifierFailure(identifier: string): void {
  const key = identifierKey(identifier);
  const state = identifierFailures.get(key) ?? { failures: 0, blockedUntil: 0 };
  state.failures += 1;
  if (state.failures >= 5) {
    const backoffMs = Math.min(15 * 60_000, 5_000 * (state.failures - 4));
    state.blockedUntil = Math.max(state.blockedUntil, Date.now() + backoffMs);
  }
  identifierFailures.set(key, state);
}

export function clearIdentifierFailures(identifier: string): void {
  identifierFailures.delete(identifierKey(identifier));
}

/** Seconds until the identifier may try again; 0 when not blocked. */
export function identifierBlockedSeconds(identifier: string): number {
  const state = identifierFailures.get(identifierKey(identifier));
  if (!state) return 0;
  const remaining = state.blockedUntil - Date.now();
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

/** Test helpers */
export function _resetRateLimitBucketsForTests(): void {
  buckets.clear();
  identifierFailures.clear();
  lastSweepAt = 0;
}

export function _bucketCountForTests(): number {
  return buckets.size;
}
