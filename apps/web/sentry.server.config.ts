/**
 * Server Sentry (SSR / getServerSideProps) — inert when SENTRY_DSN /
 * NEXT_PUBLIC_SENTRY_DSN is unset.
 */
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN?.trim() || process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    release: process.env.SENTRY_RELEASE || process.env.COMMIT_REF || undefined,
    tracesSampleRate: 0,
  });
}
