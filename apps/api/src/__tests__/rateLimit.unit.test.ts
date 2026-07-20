/**
 * Phase 7 Chunk A — rate limiter mechanics (unit).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import {
  _bucketCountForTests,
  _resetRateLimitBucketsForTests,
  authRateLimit,
  clearAuthFailures,
  clearIdentifierFailures,
  identifierBlockedSeconds,
  noteAuthFailure,
  noteIdentifierFailure,
} from "../lib/rateLimit";

function mockReq(overrides: Record<string, unknown> = {}): Request {
  return {
    ip: "1.2.3.4",
    baseUrl: "",
    path: "/x",
    headers: {},
    socket: {},
    ...overrides,
  } as unknown as Request;
}

function mockRes(): { res: Response; status: () => number } {
  let statusCode = 200;
  const res = {
    setHeader() {},
    status(code: number) {
      statusCode = code;
      return this;
    },
    json() {
      return this;
    },
  } as unknown as Response;
  return { res, status: () => statusCode };
}

function callStatus(mw: ReturnType<typeof authRateLimit>, req: Request): number {
  const { res, status } = mockRes();
  let nexted = false;
  mw(req, res, () => {
    nexted = true;
  });
  return nexted ? 200 : status();
}

beforeEach(() => _resetRateLimitBucketsForTests());
afterEach(() => vi.useRealTimers());

describe("route-pattern bucket keying (enumeration)", () => {
  it("distinct :certificateId values share ONE bucket per IP", () => {
    const mw = authRateLimit({ windowMs: 60_000, max: 3 });
    const reqFor = (id: string) =>
      mockReq({
        baseUrl: "/verify",
        route: { path: "/:certificateId" },
        path: `/${id}`,
        params: { certificateId: id },
      });

    expect(callStatus(mw, reqFor("AAA"))).toBe(200);
    expect(callStatus(mw, reqFor("BBB"))).toBe(200);
    expect(callStatus(mw, reqFor("CCC"))).toBe(200);
    // 4th guess with yet another ID must hit the shared bucket, not a fresh one.
    expect(callStatus(mw, reqFor("DDD"))).toBe(429);
  });

  it("different routes keep separate buckets", () => {
    const mw = authRateLimit({ windowMs: 60_000, max: 1 });
    const a = mockReq({ baseUrl: "/auth", route: { path: "/login" }, path: "/login" });
    const b = mockReq({ baseUrl: "/auth", route: { path: "/register" }, path: "/register" });
    expect(callStatus(mw, a)).toBe(200);
    expect(callStatus(mw, b)).toBe(200);
    expect(callStatus(mw, a)).toBe(429);
  });
});

describe("X-Forwarded-For spoofing", () => {
  it("a forged XFF header does not mint fresh buckets", () => {
    const mw = authRateLimit({ windowMs: 60_000, max: 2 });
    const reqWithXff = (xff: string) =>
      mockReq({
        ip: "9.9.9.9",
        route: { path: "/login" },
        baseUrl: "/auth",
        path: "/login",
        headers: { "x-forwarded-for": xff },
      });

    expect(callStatus(mw, reqWithXff("10.0.0.1"))).toBe(200);
    expect(callStatus(mw, reqWithXff("10.0.0.2"))).toBe(200);
    expect(callStatus(mw, reqWithXff("10.0.0.3"))).toBe(429);
    expect(callStatus(mw, reqWithXff("10.0.0.4, 10.0.0.5"))).toBe(429);
  });

  it("genuinely distinct req.ip values (trust-proxy resolved) get separate buckets", () => {
    const mw = authRateLimit({ windowMs: 60_000, max: 1 });
    const route = { baseUrl: "/auth", route: { path: "/login" }, path: "/login" };
    expect(callStatus(mw, mockReq({ ...route, ip: "1.1.1.1" }))).toBe(200);
    expect(callStatus(mw, mockReq({ ...route, ip: "2.2.2.2" }))).toBe(200);
    expect(callStatus(mw, mockReq({ ...route, ip: "1.1.1.1" }))).toBe(429);
  });
});

describe("keyBy user", () => {
  it("keys authenticated buckets by user id across IPs", () => {
    const mw = authRateLimit({ windowMs: 60_000, max: 2, keyBy: "user" });
    const reqFor = (ip: string) =>
      mockReq({
        ip,
        baseUrl: "/attendees",
        route: { path: "/invite-bulk" },
        path: "/invite-bulk",
        user: { id: "user_1" },
      });
    expect(callStatus(mw, reqFor("1.1.1.1"))).toBe(200);
    expect(callStatus(mw, reqFor("2.2.2.2"))).toBe(200);
    expect(callStatus(mw, reqFor("3.3.3.3"))).toBe(429);
  });

  it("falls back to IP when unauthenticated", () => {
    const mw = authRateLimit({ windowMs: 60_000, max: 1, keyBy: "user" });
    const route = { baseUrl: "/attendees", route: { path: "/invite-bulk" }, path: "/invite-bulk" };
    expect(callStatus(mw, mockReq({ ...route, ip: "1.1.1.1" }))).toBe(200);
    expect(callStatus(mw, mockReq({ ...route, ip: "1.1.1.1" }))).toBe(429);
  });
});

describe("auth failure backoff (IP+route bucket)", () => {
  it("noteAuthFailure blocks subsequent requests; clearAuthFailures unblocks", () => {
    const mw = authRateLimit({ windowMs: 60_000, max: 5 });
    const req = mockReq({ baseUrl: "/auth", route: { path: "/login" }, path: "/login" });

    expect(callStatus(mw, req)).toBe(200);
    noteAuthFailure(req);
    expect(callStatus(mw, req)).toBe(429);
    clearAuthFailures(req);
    expect(callStatus(mw, req)).toBe(200);
  });
});

describe("per-identifier (hashed email) backoff", () => {
  it("blocks after repeated failures regardless of client IP", () => {
    const email = "victim@example.org";
    // Simulates a distributed attack: the identifier key has no IP component,
    // so failures "from different IPs" accumulate on the same account.
    for (let i = 0; i < 4; i++) noteIdentifierFailure(email);
    expect(identifierBlockedSeconds(email)).toBe(0);
    noteIdentifierFailure(email);
    expect(identifierBlockedSeconds(email)).toBeGreaterThan(0);
    // Case/whitespace-insensitive, other accounts unaffected.
    expect(identifierBlockedSeconds("  VICTIM@example.org ")).toBeGreaterThan(0);
    expect(identifierBlockedSeconds("other@example.org")).toBe(0);
  });

  it("clearIdentifierFailures resets the account", () => {
    const email = "victim@example.org";
    for (let i = 0; i < 6; i++) noteIdentifierFailure(email);
    expect(identifierBlockedSeconds(email)).toBeGreaterThan(0);
    clearIdentifierFailures(email);
    expect(identifierBlockedSeconds(email)).toBe(0);
  });
});

describe("bucket pruning", () => {
  it("expired buckets are swept so the map cannot grow unbounded", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T00:00:00Z"));

    const mw = authRateLimit({ windowMs: 60_000, max: 5 });
    for (let i = 0; i < 50; i++) {
      callStatus(mw, mockReq({ ip: `10.0.0.${i}`, route: { path: "/login" }, baseUrl: "/auth", path: "/login" }));
    }
    expect(_bucketCountForTests()).toBe(50);

    // Beyond window + stale grace + sweep interval: next request sweeps them.
    vi.advanceTimersByTime(30 * 60_000);
    callStatus(mw, mockReq({ ip: "99.99.99.99", route: { path: "/login" }, baseUrl: "/auth", path: "/login" }));
    expect(_bucketCountForTests()).toBe(1);
  });
});
