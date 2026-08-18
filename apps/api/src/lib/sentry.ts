/**
 * Optional Sentry wiring. Entirely inert when SENTRY_DSN is unset —
 * no SDK init, no network calls, no process hooks.
 */

import * as Sentry from "@sentry/node";

let initialized = false;

function releaseTag(): string | undefined {
  return (
    process.env.SENTRY_RELEASE?.trim() ||
    process.env.RENDER_GIT_COMMIT?.trim() ||
    process.env.COMMIT_SHA?.trim() ||
    undefined
  );
}

/** Call once at process boot (before listen). No-op without SENTRY_DSN. */
export function initSentry(): boolean {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) {
    initialized = false;
    return false;
  }
  if (initialized) return true;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    release: releaseTag(),
    // Keep default integrations; we capture from our own error middleware / job catch.
    tracesSampleRate: 0,
  });
  initialized = true;
  return true;
}

export function isSentryEnabled(): boolean {
  return initialized;
}

export function captureException(
  err: unknown,
  context?: {
    requestId?: string;
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
    /** Overrides Sentry's default stack-trace grouping. See JOB_DB_CONNECTION_DROP_FINGERPRINT. */
    fingerprint?: string[];
  },
): void {
  if (!initialized) return;
  Sentry.withScope((scope) => {
    if (context?.requestId) scope.setTag("requestId", context.requestId);
    if (context?.tags) {
      for (const [k, v] of Object.entries(context.tags)) scope.setTag(k, v);
    }
    if (context?.extra) scope.setExtras(context.extra);
    if (context?.fingerprint?.length) scope.setFingerprint(context.fingerprint);
    Sentry.captureException(err);
  });
}

/**
 * Prisma codes that mean "the connection went away", not "this caller is broken":
 * P1001 can't reach the database, P1002 initial connect timed out, P1008 the
 * operation timed out, P1017 the server closed the connection, P2024 timed out
 * checking a connection out of the pool.
 */
const PRISMA_CONNECTION_DROP_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024"]);

/**
 * The Prisma connection-drop code carried by `err`, or null when the error is
 * something else. Matches PrismaClientKnownRequestError and its initialization
 * sibling, both of which expose a string `code`.
 */
export function prismaConnectionDropCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const { name, code } = err as { name?: unknown; code?: unknown };
  if (typeof name !== "string" || !name.startsWith("PrismaClient")) return null;
  if (typeof code !== "string" || !PRISMA_CONNECTION_DROP_CODES.has(code)) return null;
  return code;
}

/**
 * HARDEN-1 — one Postgres blip is one incident, not one issue per job type.
 * Sentry groups by stack trace, so a burst of connection drops from the job
 * subsystem opened a separate ongoing issue for every handler that happened to
 * be running. A static fingerprint collapses the burst into a single issue; the
 * job type and Prisma code stay on as tags so they remain searchable.
 */
export const JOB_DB_CONNECTION_DROP_FINGERPRINT = ["background-job", "prisma-connection-drop"];

/** Test helper — reset so init can be re-exercised. */
export function _resetSentryForTests(): void {
  initialized = false;
}
