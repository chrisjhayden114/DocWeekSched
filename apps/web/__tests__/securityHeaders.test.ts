/**
 * Phase 7 Chunk E — security headers + CSP.
 *
 * Unit: exact header values, Report-Only default, CSP_ENFORCE flip, and the
 * regression lock that script-src never contains 'unsafe-inline'.
 * Integration: a real rendered page from a programmatic Next server carries
 * every header.
 */

import { createServer, type Server } from "http";
import { resolve } from "path";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { apiOrigin, sentryIngestOrigin, buildCsp, buildSecurityHeaders } = require("../lib/securityHeaders") as {
  apiOrigin: (rawUrl?: string) => string;
  sentryIngestOrigin: (dsn?: string) => string | null;
  buildCsp: (opts?: { apiUrl?: string; sentryDsn?: string }) => string;
  buildSecurityHeaders: (opts?: {
    apiUrl?: string;
    sentryDsn?: string;
    enforceCsp?: boolean;
  }) => Array<{ key: string; value: string }>;
};

function headerMap(headers: Array<{ key: string; value: string }>): Map<string, string> {
  return new Map(headers.map((h) => [h.key, h.value]));
}

function cspDirective(csp: string, name: string): string | null {
  const found = csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `));
  return found ?? null;
}

describe("buildSecurityHeaders — exact values", () => {
  const map = headerMap(buildSecurityHeaders({ apiUrl: "https://api.ukedl.com" }));

  it("HSTS one year + includeSubDomains, no preload", () => {
    expect(map.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
  });

  it("nosniff, frame DENY, referrer policy", () => {
    expect(map.get("X-Content-Type-Options")).toBe("nosniff");
    expect(map.get("X-Frame-Options")).toBe("DENY");
    expect(map.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("Permissions-Policy keeps camera=self for the QR scanner", () => {
    expect(map.get("Permissions-Policy")).toBe("camera=(self), microphone=(), geolocation=()");
  });

  it("ships CSP as Report-Only by default", () => {
    expect(map.has("Content-Security-Policy-Report-Only")).toBe(true);
    expect(map.has("Content-Security-Policy")).toBe(false);
  });

  it("CSP_ENFORCE flips the header name without changing the policy", () => {
    const enforced = headerMap(buildSecurityHeaders({ apiUrl: "https://api.ukedl.com", enforceCsp: true }));
    expect(enforced.has("Content-Security-Policy")).toBe(true);
    expect(enforced.has("Content-Security-Policy-Report-Only")).toBe(false);
    expect(enforced.get("Content-Security-Policy")).toBe(map.get("Content-Security-Policy-Report-Only"));
  });
});

describe("CSP policy string", () => {
  const csp = buildCsp({ apiUrl: "https://api.ukedl.com" });

  it("matches the approved directive set", () => {
    expect(cspDirective(csp, "default-src")).toBe("default-src 'self'");
    expect(cspDirective(csp, "script-src")).toBe("script-src 'self'");
    expect(cspDirective(csp, "style-src")).toBe("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
    expect(cspDirective(csp, "font-src")).toBe("font-src https://fonts.gstatic.com");
    expect(cspDirective(csp, "img-src")).toBe("img-src 'self' data: blob: https:");
    expect(cspDirective(csp, "connect-src")).toBe("connect-src 'self' https://api.ukedl.com");
    expect(cspDirective(csp, "worker-src")).toBe("worker-src 'self'");
    expect(cspDirective(csp, "manifest-src")).toBe("manifest-src 'self'");
    expect(cspDirective(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(cspDirective(csp, "base-uri")).toBe("base-uri 'self'");
    expect(cspDirective(csp, "form-action")).toBe("form-action 'self'");
    expect(cspDirective(csp, "media-src")).toBe("media-src 'self' blob:");
  });

  it("REGRESSION LOCK: script-src never contains 'unsafe-inline'", () => {
    // Standing decision: fix violations with nonces or longer report-only,
    // never by weakening script-src. This test is the tripwire.
    const scriptSrc = cspDirective(csp, "script-src");
    expect(scriptSrc).not.toBeNull();
    expect(scriptSrc).not.toContain("unsafe-inline");
    expect(scriptSrc).not.toContain("unsafe-eval");
  });

  it("connect-src uses the API origin (path/trailing slash stripped, bad URL falls back)", () => {
    expect(apiOrigin("https://api.ukedl.com/some/path/")).toBe("https://api.ukedl.com");
    expect(apiOrigin(undefined)).toBe("http://localhost:4000");
    expect(apiOrigin("not a url")).toBe("http://localhost:4000");
    expect(buildCsp({ apiUrl: "http://localhost:4000" })).toContain("connect-src 'self' http://localhost:4000");
  });

  it("connect-src is exactly 'self' + API origin when no Sentry DSN is set", () => {
    const noDsn = buildCsp({ apiUrl: "https://api.ukedl.com" });
    expect(cspDirective(noDsn, "connect-src")).toBe("connect-src 'self' https://api.ukedl.com");
    const emptyDsn = buildCsp({ apiUrl: "https://api.ukedl.com", sentryDsn: "  " });
    expect(cspDirective(emptyDsn, "connect-src")).toBe("connect-src 'self' https://api.ukedl.com");
  });

  it("connect-src includes the DSN's exact ingest origin when set — never a wildcard", () => {
    const dsn = "https://abc123publickey@o424242.ingest.us.sentry.io/4507000000000000";
    expect(sentryIngestOrigin(dsn)).toBe("https://o424242.ingest.us.sentry.io");
    expect(sentryIngestOrigin(undefined)).toBeNull();
    expect(sentryIngestOrigin("not a dsn")).toBeNull();

    const withDsn = buildCsp({ apiUrl: "https://api.ukedl.com", sentryDsn: dsn });
    expect(cspDirective(withDsn, "connect-src")).toBe(
      "connect-src 'self' https://api.ukedl.com https://o424242.ingest.us.sentry.io",
    );
    expect(withDsn).not.toContain("*");
    // script-src is untouched by the Sentry addition.
    expect(cspDirective(withDsn, "script-src")).toBe("script-src 'self'");
  });

  it("headers() wiring passes the DSN through to the CSP header", () => {
    const dsn = "https://key@o1.ingest.sentry.io/2";
    const map = headerMap(buildSecurityHeaders({ apiUrl: "https://api.ukedl.com", sentryDsn: dsn }));
    expect(map.get("Content-Security-Policy-Report-Only")).toContain("https://o1.ingest.sentry.io");
  });
});

describe("rendered page carries every header", () => {
  let server: Server;
  let base = "";
  let closeNext: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const next = require("next");
    const app = next({ dev: true, dir: resolve(__dirname, "..") });
    await app.prepare();
    const handler = app.getRequestHandler();
    server = createServer((req, res) => void handler(req, res));
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    closeNext = () => app.close();
  });

  afterAll(async () => {
    await new Promise<void>((resolveClose, reject) =>
      server.close((err) => (err ? reject(err) : resolveClose())),
    );
    if (closeNext) await closeNext();
  });

  it("GET /login responds with all security headers (CSP report-only)", async () => {
    const res = await fetch(`${base}/login`);
    expect(res.status).toBe(200);

    expect(res.headers.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("Permissions-Policy")).toBe("camera=(self), microphone=(), geolocation=()");

    const reportOnly = res.headers.get("Content-Security-Policy-Report-Only");
    expect(reportOnly).toBeTruthy();
    expect(res.headers.get("Content-Security-Policy")).toBeNull();
    expect(reportOnly).toContain("script-src 'self'");
    expect(reportOnly).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(reportOnly).toContain("frame-ancestors 'none'");
    expect(reportOnly).toContain("connect-src 'self' http://localhost:4000");
  });

  it("headers also apply to 404 responses", async () => {
    const res = await fetch(`${base}/definitely-not-a-real-page`);
    expect(res.status).toBe(404);
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Content-Security-Policy-Report-Only")).toBeTruthy();
  });
});
