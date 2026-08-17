import { describe, expect, it } from "vitest";
import { hashToken } from "../lib/auth";
import {
  evaluatePortalAccess,
  hashPortalToken,
  newPortalToken,
  PORTAL_TOKEN_DAYS,
  portalExpiresAt,
} from "../lib/readiness/portalTokens";

describe("readiness portal tokens (ER4 / O1)", () => {
  const now = new Date("2026-08-17T12:00:00Z");

  it("mints a raw token, stores only the sha256 hash, and expires in 30 days", () => {
    const token = newPortalToken(now);
    expect(token.raw).toMatch(/^[0-9a-f]{64}$/);
    expect(token.hash).toBe(hashToken(token.raw));
    expect(token.hash).toBe(hashPortalToken(token.raw));
    expect(token.hash).not.toBe(token.raw);
    expect(token.expiresAt.getTime()).toBe(portalExpiresAt(now).getTime());
    expect(token.expiresAt.getTime() - now.getTime()).toBe(PORTAL_TOKEN_DAYS * 24 * 60 * 60 * 1000);
  });

  it("treats a missing row as unknown, a revoked row as revoked, and a past expiresAt as expired", () => {
    expect(evaluatePortalAccess(null, now)).toEqual({ ok: false, reason: "unknown" });
    expect(
      evaluatePortalAccess({ expiresAt: portalExpiresAt(now), revokedAt: now }, now),
    ).toEqual({ ok: false, reason: "revoked" });
    expect(
      evaluatePortalAccess({ expiresAt: new Date(now.getTime() - 1000), revokedAt: null }, now),
    ).toEqual({ ok: false, reason: "expired" });
    expect(
      evaluatePortalAccess({ expiresAt: portalExpiresAt(now), revokedAt: null }, now),
    ).toEqual({ ok: true });
  });

  it("remint produces a new hash so the old raw token no longer matches", () => {
    const first = newPortalToken(now);
    const second = newPortalToken(now);
    expect(second.raw).not.toBe(first.raw);
    expect(second.hash).not.toBe(first.hash);
    expect(hashPortalToken(first.raw)).not.toBe(second.hash);
  });
});
