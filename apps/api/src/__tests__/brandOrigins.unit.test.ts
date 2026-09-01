/**
 * BRAND-R1 — the CORS allowlist accepts BOTH brands' origins.
 *
 * The runbook flips code before DNS and keeps ukedl.com 301-ing to
 * readyhall.com indefinitely, so at no point in the sequence is exactly one
 * origin correct: before the cutover the browser is on the old host while
 * WEB_BASE_URL may already name the new one, after it a bookmark or an emailed
 * link still arrives from the old one. An allowlist derived from WEB_BASE_URL
 * alone — which is what this replaced — breaks every request from the other side.
 */

import { describe, expect, it } from "vitest";
import { brand, brandTransition, webOriginAllowlist } from "@event-app/config";

const NEW_ORIGIN = `https://${brand.domain}`;
const LEGACY_DOMAIN = brandTransition.legacyWebDomains[0]!;
const LEGACY_ORIGIN = `https://${LEGACY_DOMAIN}`;

describe("webOriginAllowlist — both origins through the transition", () => {
  it("accepts the new and the legacy origin when WEB_BASE_URL names the new one", () => {
    const allowed = webOriginAllowlist(NEW_ORIGIN);
    expect(allowed).toContain(NEW_ORIGIN);
    expect(allowed).toContain(`https://www.${brand.domain}`);
    expect(allowed).toContain(LEGACY_ORIGIN);
    expect(allowed).toContain(`https://www.${LEGACY_DOMAIN}`);
  });

  it("accepts both the same way when WEB_BASE_URL still names the legacy one", () => {
    const allowed = webOriginAllowlist(LEGACY_ORIGIN);
    expect(allowed).toContain(LEGACY_ORIGIN);
    expect(allowed).toContain(`https://www.${LEGACY_DOMAIN}`);
    expect(allowed).toContain(NEW_ORIGIN);
    expect(allowed).toContain(`https://www.${brand.domain}`);
  });

  it("keeps a localhost dev origin exactly as configured, port and all", () => {
    const allowed = webOriginAllowlist("http://localhost:3000");
    expect(allowed).toContain("http://localhost:3000");
    // No www.localhost, and no http origin invented for the public hosts.
    expect(allowed.some((origin) => origin.includes("www.localhost"))).toBe(false);
    expect(allowed.every((origin) => origin.startsWith("https://") || origin === "http://localhost:3000")).toBe(true);
  });

  it("tolerates a trailing slash and a www-form WEB_BASE_URL", () => {
    expect(webOriginAllowlist(`${NEW_ORIGIN}/`)).toContain(NEW_ORIGIN);
    const fromWww = webOriginAllowlist(`https://www.${brand.domain}`);
    expect(fromWww).toContain(NEW_ORIGIN);
    expect(fromWww).toContain(`https://www.${brand.domain}`);
  });

  it("appends WEB_ORIGIN_ALIASES entries and never duplicates an origin", () => {
    const allowed = webOriginAllowlist(NEW_ORIGIN, ["https://deploy-preview-7--site.netlify.app/", NEW_ORIGIN]);
    expect(allowed).toContain("https://deploy-preview-7--site.netlify.app");
    expect(new Set(allowed).size).toBe(allowed.length);
  });

  it("refuses an origin that is neither configured nor in the transition list", () => {
    const allowed = new Set(webOriginAllowlist(NEW_ORIGIN));
    expect(allowed.has("https://evil.example")).toBe(false);
    expect(allowed.has(`http://${brand.domain}`)).toBe(false);
    expect(allowed.has(`https://readyhall.com.evil.example`)).toBe(false);
  });
});

describe("brandTransition — the API origins named in the web CSP", () => {
  it("covers the host the cutover moves to and the one it moves from", () => {
    expect(brandTransition.extraApiOrigins).toContain(`https://api.${brand.domain}`);
    expect(brandTransition.extraApiOrigins.some((origin) => /ukedl/i.test(origin))).toBe(true);
  });
});
