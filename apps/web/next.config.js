const { buildSecurityHeaders } = require("./lib/securityHeaders");

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@event-app/config", "@event-app/shared"],
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: buildSecurityHeaders({
          apiUrl: process.env.NEXT_PUBLIC_API_URL,
          // Report-Only by default; flip to enforcing via CSP_ENFORCE=1 at
          // build time once report-only has been verified (LAUNCH_CHECKLIST).
          enforceCsp: process.env.CSP_ENFORCE === "1",
        }),
      },
    ];
  },
};

// withSentryConfig is a no-op for builds when no DSN/auth token is set; source
// maps upload is skipped. Runtime capture still gates on the DSN in sentry.*.config.ts.
const { withSentryConfig } = require("@sentry/nextjs");

module.exports = withSentryConfig(nextConfig, {
  silent: true,
  // Don't fail the Netlify build when Sentry auth isn't configured.
  dryRun: !process.env.SENTRY_AUTH_TOKEN,
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
  },
});
