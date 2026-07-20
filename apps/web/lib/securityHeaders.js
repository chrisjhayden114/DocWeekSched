/**
 * Phase 7 Chunk E — security headers + CSP for every route.
 *
 * CommonJS on purpose: required by next.config.js at build time and imported
 * by the header tests. The CSP ships as Report-Only until CSP_ENFORCE=1
 * (cutover checklist flips it after watching reports).
 *
 * STANDING DECISION: never add 'unsafe-inline' to script-src. If a
 * Next-generated inline script violates in report-only, escalate (longer
 * report-only or nonces) — do not weaken the policy.
 */

/** Origin for connect-src; mirrors the default in lib/api.ts. */
function apiOrigin(rawUrl) {
  const raw = (rawUrl || "http://localhost:4000").trim();
  try {
    return new URL(raw).origin;
  } catch {
    return "http://localhost:4000";
  }
}

function buildCsp({ apiUrl } = {}) {
  const directives = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    `connect-src 'self' ${apiOrigin(apiUrl)}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "media-src 'self' blob:",
  ];
  return directives.join("; ");
}

/**
 * Header list for next.config.js headers().
 * @param {{ apiUrl?: string, enforceCsp?: boolean }} opts
 */
function buildSecurityHeaders({ apiUrl, enforceCsp } = {}) {
  return [
    // No `preload` yet — submitting to the preload list is a cutover item.
    { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // camera=(self) is required by the QR check-in scanner's getUserMedia.
    { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
    {
      key: enforceCsp ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only",
      value: buildCsp({ apiUrl }),
    },
  ];
}

module.exports = { apiOrigin, buildCsp, buildSecurityHeaders };
