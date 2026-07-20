/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@event-app/config", "@event-app/shared"],
  reactStrictMode: true,
};

// withSentryConfig is a no-op for builds when no DSN/auth token is set; source
// maps upload is skipped. Runtime capture still gates on the DSN in sentry.*.config.ts.
const { withSentryConfig } = require("@sentry/nextjs");

module.exports = withSentryConfig(nextConfig, {
  silent: true,
  disableLogger: true,
  // Don't fail the Netlify build when Sentry auth isn't configured.
  dryRun: !process.env.SENTRY_AUTH_TOKEN,
});
