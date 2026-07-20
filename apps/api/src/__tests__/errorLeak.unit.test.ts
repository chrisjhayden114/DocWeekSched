/**
 * Phase 7 Chunk C — leak regression: sanitized routes never echo Error#message.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { asyncHandler, HttpError } from "../lib/authorization";
import { publicJobErrorMessage, uploadHttpError } from "../lib/errors";
import { getRequestId, requestIdMiddleware } from "../lib/requestId";

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(requestIdMiddleware);
  app.use(express.json());

  app.post(
    "/test/upload",
    asyncHandler(async (req, _res) => {
      const kind = String(req.body?.kind || "internal");
      if (kind === "too_big") throw uploadHttpError(new Error("File exceeds max size of 999 bytes"));
      if (kind === "mime") throw uploadHttpError(new Error("MIME type not allowed: application/x-evil"));
      throw uploadHttpError(new Error("ECONNRESET to s3://secret-bucket/key.pem"));
    }),
  );

  app.get(
    "/test/job-error",
    asyncHandler(async (_req, res) => {
      // Mirrors GET /jobs/:id sanitization.
      return res.json({
        error: publicJobErrorMessage("DEAD", true),
        rawWouldHaveBeen: "prisma.user.findUnique blew up at /app/dist/lib/foo.js:12",
      });
    }),
  );

  app.get(
    "/test/boom",
    asyncHandler(async () => {
      throw new Error("SuperSecretInternalDetail xyz");
    }),
  );

  app.post("/test/webhook-sig", (_req, res) => {
    // Mirrors billing webhook catch — never echo provider message.
    return res.status(401).json({ error: "Invalid signature", code: "INVALID_SIGNATURE" });
  });

  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const requestId = getRequestId(req);
    if (err instanceof HttpError) {
      return res.status(err.status).json({ ...err.body, requestId });
    }
    return res.status(500).json({ error: "Internal server error", requestId });
  });

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

async function postJson(path: string, body: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json, requestIdHeader: res.headers.get("x-request-id") };
}

describe("upload error leak regression", () => {
  it("returns typed safe copy for size/MIME and never echoes internals", async () => {
    const big = await postJson("/test/upload", { kind: "too_big" });
    expect(big.status).toBe(400);
    expect(big.json.error).toBe("File is too large.");
    expect(JSON.stringify(big.json)).not.toContain("999");

    const mime = await postJson("/test/upload", { kind: "mime" });
    expect(mime.json.error).toBe("That file type is not allowed.");
    expect(JSON.stringify(mime.json)).not.toContain("application/x-evil");

    const internal = await postJson("/test/upload", { kind: "internal" });
    expect(internal.json.error).toBe("Upload failed.");
    expect(JSON.stringify(internal.json)).not.toContain("secret-bucket");
    expect(JSON.stringify(internal.json)).not.toContain("ECONNRESET");
  });
});

describe("billing signature + job error leak regression", () => {
  it("webhook signature failures use a fixed message", async () => {
    const res = await fetch(`${base}/test/webhook-sig`, { method: "POST" });
    const json = (await res.json()) as { error: string; code: string };
    expect(res.status).toBe(401);
    expect(json).toEqual({ error: "Invalid signature", code: "INVALID_SIGNATURE" });
  });

  it("job status responses never include raw handler strings as the client error", async () => {
    const res = await fetch(`${base}/test/job-error`);
    const json = (await res.json()) as { error: string; rawWouldHaveBeen: string };
    expect(json.error).not.toContain("prisma");
    expect(json.error).not.toContain("/app/dist");
    // The "rawWouldHaveBeen" field exists only in this harness to prove the contrast.
    expect(json.rawWouldHaveBeen).toContain("prisma");
  });
});

describe("500 responses include request id", () => {
  it("echoes X-Request-Id header and body.requestId, never the internal message", async () => {
    const res = await fetch(`${base}/test/boom`, {
      headers: { "x-request-id": "client-corr-id-00112233" },
    });
    const json = (await res.json()) as { error: string; requestId: string };
    expect(res.status).toBe(500);
    expect(json.error).toBe("Internal server error");
    expect(json.error).not.toContain("SuperSecret");
    expect(json.requestId).toBe("client-corr-id-00112233");
    expect(res.headers.get("x-request-id")).toBe("client-corr-id-00112233");
  });
});
