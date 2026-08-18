import { describe, expect, it } from "vitest";
import { hashToken } from "../lib/auth";
import {
  CLEARED_GRACE_SLOT,
  evaluatePortalAccess,
  hashPortalToken,
  matchPortalToken,
  newPortalToken,
  PORTAL_TOKEN_DAYS,
  portalExpiresAt,
  portalRemintData,
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

describe("readiness portal link grace (ER5.1)", () => {
  const now = new Date("2026-08-17T12:00:00Z");
  const later = (ms: number) => new Date(now.getTime() + ms);
  const DAY_MS = 24 * 60 * 60 * 1000;

  /** A minted token as the row stores it. */
  const stored = (token: { hash: string; expiresAt: Date }) => ({
    tokenHash: token.hash,
    expiresAt: token.expiresAt,
  });

  /** A row as it stands after one remint at `at`. */
  const afterOneRemint = (at: Date) => {
    const first = newPortalToken(now);
    const second = newPortalToken(at);
    const row = {
      ...portalRemintData(stored(first), second),
      revokedAt: null as Date | null,
    };
    return { first, second, row };
  };

  it("carries the outgoing token into the grace slot on its ORIGINAL expiry", () => {
    const { first, second, row } = afterOneRemint(later(10 * DAY_MS));
    expect(row.tokenHash).toBe(second.hash);
    expect(row.expiresAt).toEqual(second.expiresAt);
    expect(row.previousTokenHash).toBe(first.hash);
    // Grace declines to smash the old clock; it never winds it forward.
    expect(row.previousExpiresAt).toEqual(first.expiresAt);
    expect(row.previousExpiresAt!.getTime()).toBeLessThan(row.expiresAt.getTime());
  });

  it("accepts either hash while both are live, and says which slot answered", () => {
    const at = later(10 * DAY_MS);
    const { first, second, row } = afterOneRemint(at);
    expect(matchPortalToken(row, second.hash, at)).toEqual({ ok: true, slot: "current" });
    expect(matchPortalToken(row, first.hash, at)).toEqual({ ok: true, slot: "previous" });
    expect(matchPortalToken(row, hashPortalToken("nonsense"), at)).toEqual({
      ok: false,
      reason: "unknown",
    });
    expect(matchPortalToken(null, second.hash, at)).toEqual({ ok: false, reason: "unknown" });
  });

  it("expires the previous slot on its own schedule while the new link lives on", () => {
    const remintAt = later(10 * DAY_MS);
    const { first, second, row } = afterOneRemint(remintAt);
    // Day 31: the original 30-day clock has run out, the fresh one has not.
    const afterOldExpiry = later(31 * DAY_MS);
    expect(matchPortalToken(row, first.hash, afterOldExpiry)).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(matchPortalToken(row, second.hash, afterOldExpiry)).toEqual({
      ok: true,
      slot: "current",
    });
  });

  it("keeps only one older link: a second remint retires the oldest", () => {
    const first = newPortalToken(now);
    const second = newPortalToken(later(DAY_MS));
    const third = newPortalToken(later(2 * DAY_MS));
    const afterFirst = portalRemintData(stored(first), second);
    const afterSecond = portalRemintData(
      { tokenHash: afterFirst.tokenHash, expiresAt: afterFirst.expiresAt },
      third,
    );
    const row = { ...afterSecond, revokedAt: null };
    const at = later(3 * DAY_MS);
    expect(matchPortalToken(row, third.hash, at)).toEqual({ ok: true, slot: "current" });
    expect(matchPortalToken(row, second.hash, at)).toEqual({ ok: true, slot: "previous" });
    expect(matchPortalToken(row, first.hash, at)).toEqual({ ok: false, reason: "unknown" });
  });

  it("revocation is absolute: both slots deny, and neither hash is thrown away", () => {
    const at = later(10 * DAY_MS);
    const { first, second, row } = afterOneRemint(at);
    const revoked = { ...row, revokedAt: at };
    expect(matchPortalToken(revoked, second.hash, at)).toEqual({ ok: false, reason: "revoked" });
    expect(matchPortalToken(revoked, first.hash, at)).toEqual({ ok: false, reason: "revoked" });
    // ER5.3 — those two answers are only reachable because revoke leaves both
    // hashes stored; the cleared slot belongs to a brand-new invite, not revoke.
    expect(CLEARED_GRACE_SLOT).toEqual({ previousTokenHash: null, previousExpiresAt: null });
  });

  it("reminting a revoked row does not resurrect the revoked token as grace", () => {
    const revokedToken = newPortalToken(now);
    const fresh = newPortalToken(later(DAY_MS));
    const row = { ...portalRemintData(stored(revokedToken), fresh, false), revokedAt: null };
    const at = later(2 * DAY_MS);
    expect(row.previousTokenHash).toBeNull();
    expect(row.previousExpiresAt).toBeNull();
    expect(matchPortalToken(row, revokedToken.hash, at)).toEqual({ ok: false, reason: "unknown" });
    expect(matchPortalToken(row, fresh.hash, at)).toEqual({ ok: true, slot: "current" });
  });

  it("a grace slot with no expiry recorded is dead, not immortal", () => {
    const token = newPortalToken(now);
    const row = {
      tokenHash: newPortalToken(now).hash,
      expiresAt: portalExpiresAt(now),
      previousTokenHash: token.hash,
      previousExpiresAt: null,
      revokedAt: null,
    };
    expect(matchPortalToken(row, token.hash, now)).toEqual({ ok: false, reason: "expired" });
  });
});
