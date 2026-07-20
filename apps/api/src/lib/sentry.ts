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
  context?: { requestId?: string; tags?: Record<string, string>; extra?: Record<string, unknown> },
): void {
  if (!initialized) return;
  Sentry.withScope((scope) => {
    if (context?.requestId) scope.setTag("requestId", context.requestId);
    if (context?.tags) {
      for (const [k, v] of Object.entries(context.tags)) scope.setTag(k, v);
    }
    if (context?.extra) scope.setExtras(context.extra);
    Sentry.captureException(err);
  });
}

/** Test helper — reset so init can be re-exercised. */
export function _resetSentryForTests(): void {
  initialized = false;
}
