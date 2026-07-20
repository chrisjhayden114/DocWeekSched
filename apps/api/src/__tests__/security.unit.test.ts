import { describe, expect, it, beforeEach } from "vitest";
import { OrgRole } from "@prisma/client";
import { orgRoleAtLeast, HttpError } from "../lib/authorization";
import { hashToken, tokensEqual, assertPasswordAllowed } from "../lib/auth";
import { isJoinLinkActive, isSlugLinkActive } from "../lib/inviteTokens";
import { _resetRateLimitBucketsForTests, authRateLimit } from "../lib/rateLimit";
import type { Request, Response } from "express";

describe("orgRoleAtLeast", () => {
  it("orders OWNER > ADMIN > STAFF", () => {
    expect(orgRoleAtLeast(OrgRole.OWNER, OrgRole.ADMIN)).toBe(true);
    expect(orgRoleAtLeast(OrgRole.ADMIN, OrgRole.STAFF)).toBe(true);
    expect(orgRoleAtLeast(OrgRole.STAFF, OrgRole.ADMIN)).toBe(false);
    expect(orgRoleAtLeast(OrgRole.ADMIN, OrgRole.OWNER)).toBe(false);
  });
});

describe("token hashing", () => {
  it("hashes deterministically and compares safely", () => {
    const a = hashToken("secret-token");
    const b = hashToken("secret-token");
    const c = hashToken("other");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(tokensEqual(a, b)).toBe(true);
    expect(tokensEqual(a, c)).toBe(false);
  });
});

describe("invite link gates", () => {
  it("rejects revoked or expired join tokens", () => {
    expect(
      isJoinLinkActive({
        joinTokenHash: "abc",
        joinTokenRevokedAt: new Date(),
        joinTokenExpiresAt: null,
        joinTokenCapacity: null,
        joinTokenUseCount: 0,
      }),
    ).toBe(false);

    expect(
      isJoinLinkActive({
        joinTokenHash: "abc",
        joinTokenRevokedAt: null,
        joinTokenExpiresAt: new Date(Date.now() - 1000),
        joinTokenCapacity: null,
        joinTokenUseCount: 0,
      }),
    ).toBe(false);

    expect(
      isJoinLinkActive({
        joinTokenHash: "abc",
        joinTokenRevokedAt: null,
        joinTokenExpiresAt: null,
        joinTokenCapacity: 2,
        joinTokenUseCount: 2,
      }),
    ).toBe(false);

    expect(
      isJoinLinkActive({
        joinTokenHash: "abc",
        joinTokenRevokedAt: null,
        joinTokenExpiresAt: null,
        joinTokenCapacity: null,
        joinTokenUseCount: 0,
      }),
    ).toBe(true);
  });

  it("respects slug invite flags", () => {
    expect(
      isSlugLinkActive({
        slugInviteEnabled: false,
        slugInviteExpiresAt: null,
        slugInviteCapacity: null,
        slugInviteUseCount: 0,
      }),
    ).toBe(false);
    expect(
      isSlugLinkActive({
        slugInviteEnabled: true,
        slugInviteExpiresAt: null,
        slugInviteCapacity: null,
        slugInviteUseCount: 0,
      }),
    ).toBe(true);
  });
});

describe("password policy", () => {
  it("rejects short and common passwords", async () => {
    await expect(assertPasswordAllowed("short")).rejects.toThrow("PASSWORD_TOO_SHORT");
    await expect(assertPasswordAllowed("password")).rejects.toThrow("PASSWORD_BREACHED");
  });
});

describe("rate limit", () => {
  beforeEach(() => _resetRateLimitBucketsForTests());

  it("blocks after 5 requests per minute", () => {
    const mw = authRateLimit({ max: 5, windowMs: 60_000 });
    const req = { ip: "1.2.3.4", path: "/auth/login", headers: {} } as unknown as Request;
    let status = 200;
    const res = {
      setHeader() {},
      status(code: number) {
        status = code;
        return this;
      },
      json() {
        return this;
      },
    } as unknown as Response;

    for (let i = 0; i < 5; i++) {
      status = 200;
      mw(req, res, () => {});
      expect(status).toBe(200);
    }
    status = 200;
    mw(req, res, () => {});
    expect(status).toBe(429);
  });
});

describe("HttpError", () => {
  it("carries status and body", () => {
    const err = new HttpError(404, { error: "Event not found" });
    expect(err.status).toBe(404);
    expect(err.body.error).toBe("Event not found");
  });
});
