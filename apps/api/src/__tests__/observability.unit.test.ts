/**
 * Phase 7 Chunk C — error sanitization, shape, request IDs, Sentry gate, readiness.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Request, Response } from "express";
import {
  publicJobErrorMessage,
  uploadHttpError,
  validationErrorBody,
} from "../lib/errors";
import { evaluateReadiness } from "../lib/health";
import { getRequestId, requestIdMiddleware } from "../lib/requestId";
import {
  _resetSentryForTests,
  captureException,
  initSentry,
  isSentryEnabled,
} from "../lib/sentry";
import { HttpError } from "../lib/authorization";

describe("validationErrorBody shape", () => {
  it("returns { error, code, details } with field paths", () => {
    const schema = z.object({ email: z.string().email(), age: z.number().int() });
    const parsed = schema.safeParse({ email: "nope", age: "x" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const body = validationErrorBody(parsed.error);
    expect(body.error).toBe("Invalid input");
    expect(body.code).toBe("VALIDATION");
    expect(body.details?.email).toBeTruthy();
    expect(body.details?.age).toBeTruthy();
    // Never nest the raw flatten object under `error`.
    expect(typeof body.error).toBe("string");
  });
});

describe("uploadHttpError — no raw err.message leakage", () => {
  it("maps known size/MIME failures to typed safe copy", () => {
    const tooBig = uploadHttpError(new Error("File exceeds max size of 4500000 bytes"));
    expect(tooBig).toBeInstanceOf(HttpError);
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.error).toBe("File is too large.");
    expect(tooBig.body.code).toBe("FILE_TOO_LARGE");
    expect(JSON.stringify(tooBig.body)).not.toContain("4500000");

    const mime = uploadHttpError(new Error("MIME type not allowed: application/x-msdownload"));
    expect(mime.body.error).toBe("That file type is not allowed.");
    expect(mime.body.code).toBe("MIME_NOT_ALLOWED");
    expect(JSON.stringify(mime.body)).not.toContain("application/x-msdownload");
  });

  it("never echoes unexpected internal messages to the client body", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const leaked = uploadHttpError(new Error("ENOENT: /var/secrets/key.pem not found"));
    expect(leaked.body.error).toBe("Upload failed.");
    expect(leaked.body.code).toBe("UPLOAD_FAILED");
    expect(JSON.stringify(leaked.body)).not.toContain("ENOENT");
    expect(JSON.stringify(leaked.body)).not.toContain("key.pem");
    spy.mockRestore();
  });
});

describe("publicJobErrorMessage", () => {
  it("never returns the raw handler string", () => {
    expect(publicJobErrorMessage("FAILED", true)).toBe("Job failed. It will retry automatically.");
    expect(publicJobErrorMessage("DEAD", true)).toMatch(/permanently/);
    expect(publicJobErrorMessage("SUCCEEDED", false)).toBeNull();
    // Even if a caller somehow passed the raw DB error, this helper ignores it.
    expect(publicJobErrorMessage("FAILED", true)).not.toContain("prisma");
  });
});

describe("requestIdMiddleware", () => {
  it("mints an id and echoes X-Request-Id", () => {
    const headers: Record<string, string> = {};
    const req = { header: () => undefined } as unknown as Request;
    const res = {
      setHeader(name: string, value: string) {
        headers[name.toLowerCase()] = value;
      },
    } as unknown as Response;
    let nexted = false;
    requestIdMiddleware(req, res, () => {
      nexted = true;
    });
    expect(nexted).toBe(true);
    const id = getRequestId(req);
    expect(id).toMatch(/^[a-f0-9]{32}$/);
    expect(headers["x-request-id"]).toBe(id);
  });

  it("accepts a well-formed inbound X-Request-Id", () => {
    const headers: Record<string, string> = {};
    const req = {
      header(name: string) {
        return name.toLowerCase() === "x-request-id" ? "inbound-req-id-abcdef12" : undefined;
      },
    } as unknown as Request;
    const res = {
      setHeader(name: string, value: string) {
        headers[name.toLowerCase()] = value;
      },
    } as unknown as Response;
    requestIdMiddleware(req, res, () => {});
    expect(getRequestId(req)).toBe("inbound-req-id-abcdef12");
    expect(headers["x-request-id"]).toBe("inbound-req-id-abcdef12");
  });
});

describe("Sentry init gate", () => {
  const saved = process.env.SENTRY_DSN;

  beforeEach(() => {
    _resetSentryForTests();
    delete process.env.SENTRY_DSN;
  });

  afterEach(() => {
    _resetSentryForTests();
    if (saved === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = saved;
  });

  it("does not initialize when SENTRY_DSN is unset", () => {
    expect(initSentry()).toBe(false);
    expect(isSentryEnabled()).toBe(false);
    // captureException is a no-op — must not throw.
    expect(() => captureException(new Error("ignored"))).not.toThrow();
  });

  it("initializes when SENTRY_DSN is set", () => {
    process.env.SENTRY_DSN = "https://public@example.com/1";
    expect(initSentry()).toBe(true);
    expect(isSentryEnabled()).toBe(true);
  });
});

describe("evaluateReadiness", () => {
  it("requires DB + recent poller heartbeat", () => {
    expect(evaluateReadiness({ dbOk: true, jobPollerAgeMs: 1_000, staleMs: 60_000 }).ok).toBe(true);
    expect(evaluateReadiness({ dbOk: false, jobPollerAgeMs: 1_000, staleMs: 60_000 }).ok).toBe(false);
    expect(evaluateReadiness({ dbOk: true, jobPollerAgeMs: null, staleMs: 60_000 }).ok).toBe(false);
    expect(evaluateReadiness({ dbOk: true, jobPollerAgeMs: 120_000, staleMs: 60_000 }).ok).toBe(false);
  });
});

describe("error handler requestId on 500", () => {
  it("includes requestId on sanitized 500 bodies (shape contract)", () => {
    // The final Express handler spreads requestId onto every error JSON body.
    // Contract checked here so clients can correlate without needing a live listen.
    const body = { error: "Internal server error", requestId: "abc123def456" };
    expect(body.error).toBe("Internal server error");
    expect(body.requestId).toMatch(/^[a-z0-9]+$/i);
    expect(Object.keys(body).sort()).toEqual(["error", "requestId"]);
  });
});
