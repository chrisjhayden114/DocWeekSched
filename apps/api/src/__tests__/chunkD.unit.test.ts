/**
 * Phase 7 Chunk D — body limits, pagination helpers, validation error shape.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { z } from "zod";
import { jsonBodyParser, jsonLimitForPath, DEFAULT_JSON_LIMIT } from "../lib/bodyLimit";
import {
  DEFAULT_PAGE_TAKE,
  MAX_PAGE_TAKE,
  parsePagination,
  slicePage,
} from "../lib/pagination";
import { validationErrorBody } from "../lib/errors";
import { AGENDA_INGEST_MAX_BYTES } from "../lib/ai/ingest/constants";
import { extractedSessionSchema } from "../lib/ai/ingest/schema";

vi.mock("../lib/middleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/middleware")>();
  return {
    ...actual,
    requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      (req as { user?: { id: string; role: string } }).user = { id: "test-user", role: "ADMIN" };
      next();
    },
    requireCsrf: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  };
});

import { pushRouter } from "../routes/push";
import { billingRouter } from "../routes/billing";
import { cfpRouter } from "../routes/cfp";
import { meetingsRouter } from "../routes/meetings";
import { opsRouter } from "../routes/ops";
import { eventRouter } from "../routes/event";
import { sessionsRouter } from "../routes/sessions";

describe("jsonLimitForPath", () => {
  it("defaults mutating routes to 1mb", () => {
    expect(jsonLimitForPath("POST", "/auth/login")).toBe(DEFAULT_JSON_LIMIT);
    expect(jsonLimitForPath("PUT", "/notifications/x/read")).toBe("1mb");
  });

  it("raises limits for upload / ingest surfaces", () => {
    expect(jsonLimitForPath("POST", "/sessions/abc/resources")).toBe("6mb");
    expect(jsonLimitForPath("POST", "/event/maps")).toBe("10mb");
    expect(jsonLimitForPath("PUT", "/event")).toBe("16mb");
    expect(jsonLimitForPath("POST", "/ai/ingest")).toMatch(/^\d+mb$/);
    const ingestMb = Number(jsonLimitForPath("POST", "/ai/ingest").replace("mb", ""));
    expect(ingestMb).toBeGreaterThanOrEqual(Math.ceil(AGENDA_INGEST_MAX_BYTES / (1024 * 1024)));
    expect(jsonLimitForPath("POST", "/certificates/event/e1/templates")).toBe("2mb");
  });

  it("keeps GET at the default (no body)", () => {
    expect(jsonLimitForPath("GET", "/sessions")).toBe(DEFAULT_JSON_LIMIT);
  });
});

describe("pagination helpers", () => {
  it("defaults take to 500 and caps above MAX", () => {
    expect(parsePagination({})).toEqual({ take: DEFAULT_PAGE_TAKE, cursor: null });
    expect(parsePagination({ take: "10" }).take).toBe(10);
    expect(parsePagination({ take: "9999" }).take).toBe(MAX_PAGE_TAKE);
    expect(parsePagination({ take: "-1" }).take).toBe(DEFAULT_PAGE_TAKE);
    expect(parsePagination({ cursor: " abc " }).cursor).toBe("abc");
  });

  it("slicePage derives next cursor from the take+1 fetch", () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({ id: `id-${i}` }));
    const page = slicePage(rows, 2);
    expect(page.items).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe("id-1");
    const last = slicePage(rows.slice(0, 2), 2);
    expect(last.hasMore).toBe(false);
    expect(last.nextCursor).toBeNull();
  });
});

describe("ingest changeset schema shape", () => {
  const changesetRowSchema = z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("create"),
      rowIndex: z.number().int().nonnegative(),
      session: extractedSessionSchema,
      accepted: z.boolean(),
    }),
    z.object({
      kind: z.literal("update"),
      rowIndex: z.number().int().nonnegative(),
      sessionId: z.string().min(1),
      session: extractedSessionSchema,
      existingTitle: z.string(),
      message: z.string(),
      similarity: z.number().optional().default(0),
      accepted: z.boolean(),
    }),
    z.object({
      kind: z.literal("delete"),
      rowIndex: z.number().int().nonnegative(),
      sessionId: z.string().min(1),
      existingTitle: z.string(),
      message: z.string(),
      accepted: z.boolean(),
    }),
  ]);

  it("accepts create/update/delete rows and rejects loose records", () => {
    const ok = changesetRowSchema.safeParse({
      kind: "create",
      rowIndex: 0,
      accepted: true,
      session: { title: "Keynote", date: "2027-06-01", startTime: "09:00" },
    });
    expect(ok.success).toBe(true);

    const bad = changesetRowSchema.safeParse({ kind: "create", rowIndex: 0, accepted: true, session: {} });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      const body = validationErrorBody(bad.error);
      expect(body.code).toBe("VALIDATION");
      expect(typeof body.error).toBe("string");
    }
  });
});

describe("HTTP body limits", () => {
  let server: Server;
  let base = "";

  beforeAll(async () => {
    const app = express();
    app.use(jsonBodyParser);
    app.post("/echo", (req, res) => res.json({ bytes: JSON.stringify(req.body).length }));
    app.post("/sessions/s1/resources", (req, res) => res.json({ ok: true, keys: Object.keys(req.body || {}) }));
    app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const payloadErr = err as { type?: string; status?: number; statusCode?: number };
      if (
        payloadErr?.type === "entity.too.large" ||
        payloadErr?.status === 413 ||
        payloadErr?.statusCode === 413
      ) {
        return res.status(413).json({ error: "Payload too large", code: "PAYLOAD_TOO_LARGE" });
      }
      return res.status(500).json({ error: "Internal server error" });
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

  it("rejects >1mb on the global default with 413", async () => {
    const pad = "x".repeat(1.2 * 1024 * 1024);
    const res = await fetch(`${base}/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pad }),
    });
    expect(res.status).toBe(413);
    const json = (await res.json()) as { code?: string };
    expect(json.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("accepts ~2mb on a route-scoped session resource path", async () => {
    const pad = "x".repeat(2 * 1024 * 1024);
    const res = await fetch(`${base}/sessions/s1/resources`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pad }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);
  });
});

describe("newly validated routes return standard 400 shape", () => {
  let server: Server;
  let base = "";

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use("/push", pushRouter);
    app.use("/billing", billingRouter);
    app.use("/cfp", cfpRouter);
    app.use("/meetings", meetingsRouter);
    app.use("/ai/ops", opsRouter);
    app.use("/event", eventRouter);
    app.use("/sessions", sessionsRouter);
    app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const httpErr = err as { status?: number; body?: Record<string, unknown> };
      if (typeof httpErr?.status === "number" && httpErr.body) {
        return res.status(httpErr.status).json(httpErr.body);
      }
      return res.status(500).json({ error: "Internal server error" });
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

  async function post(path: string, body: unknown) {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as Record<string, unknown>;
    return { status: res.status, json };
  }

  async function del(path: string, body: unknown) {
    const res = await fetch(`${base}${path}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as Record<string, unknown>;
    return { status: res.status, json };
  }

  async function put(path: string, body: unknown) {
    const res = await fetch(`${base}${path}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as Record<string, unknown>;
    return { status: res.status, json };
  }

  function expectValidation(json: Record<string, unknown>) {
    expect(json.code).toBe("VALIDATION");
    expect(typeof json.error).toBe("string");
    expect(json.details).toBeTruthy();
  }

  it("DELETE /push/subscribe", async () => {
    const r = await del("/push/subscribe", { endpoint: "not-a-url" });
    expect(r.status).toBe(400);
    expectValidation(r.json);
  });

  it("POST /billing/portal", async () => {
    const r = await post("/billing/portal", { organizationId: 123 });
    expect(r.status).toBe(400);
    expectValidation(r.json);
  });

  it("POST /cfp/public/verify", async () => {
    const r = await post("/cfp/public/verify", { token: "" });
    expect(r.status).toBe(400);
    expectValidation(r.json);
  });

  it("POST /cfp/manage/:formId/assign", async () => {
    const r = await post("/cfp/manage/f1/assign", { mode: "not-a-mode" });
    expect(r.status).toBe(400);
    expectValidation(r.json);
  });

  it("POST /meetings/:id/accept", async () => {
    const r = await post("/meetings/m1/accept", { slotId: 99 });
    expect(r.status).toBe(400);
    expectValidation(r.json);
  });

  it("POST /ai/ops/inbox/run-detectors", async () => {
    const r = await post("/ai/ops/inbox/run-detectors", { sync: "yes" });
    expect(r.status).toBe(400);
    expectValidation(r.json);
  });

  it("POST /event/invite-links/regenerate-slug", async () => {
    const r = await post("/event/invite-links/regenerate-slug", { slug: "NOT VALID" });
    expect(r.status).toBe(400);
    expectValidation(r.json);
  });

  it("POST session Q&A answered/hide", async () => {
    const answered = await post("/sessions/s1/conversations/t1/answered", { answered: "yes" });
    expect(answered.status).toBe(400);
    expectValidation(answered.json);
    const hide = await post("/sessions/s1/conversations/t1/hide", { hidden: 1 });
    expect(hide.status).toBe(400);
    expectValidation(hide.json);
  });

  it("PUT /cfp/manage/emails/:emailId", async () => {
    const r = await put("/cfp/manage/emails/e1", { subject: "" });
    expect(r.status).toBe(400);
    expectValidation(r.json);
  });
});
