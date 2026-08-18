/**
 * Phase 7 Chunk A — every newly covered public/expensive route returns 429
 * when hammered. Runs the REAL routers over HTTP (ephemeral port). Handlers
 * may 400/404/500 underneath (bogus tokens, DB optional) — the limiter must
 * still trip; only the final over-limit response is asserted.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";
import {
  AUTHENTICATED_AI_CHAT_LIMIT,
  CONVERSATION_MESSAGE_LIMIT,
  _resetRateLimitBucketsForTests,
  authRateLimit,
} from "../lib/rateLimit";
import { authRouter } from "../routes/auth";
import { eventRouter } from "../routes/event";
import { cfpRouter } from "../routes/cfp";
import { icsRouter } from "../routes/ics";
import { billingRouter } from "../routes/billing";
import { verifyRouter } from "../routes/certificates";
import { conciergeRouter } from "../routes/concierge";
import { setupCopilotRouter } from "../routes/setupCopilot";
import { conversationsRouter } from "../routes/conversations";

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/auth", authRouter);
  app.use("/event", eventRouter);
  app.use("/cfp", cfpRouter);
  app.use("/ics", icsRouter);
  app.use("/billing", billingRouter);
  app.use("/verify", verifyRouter);
  app.use(
    (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const httpErr = err as { status?: number; body?: Record<string, unknown> };
      if (typeof httpErr?.status === "number" && httpErr.body) {
        return res.status(httpErr.status).json(httpErr.body);
      }
      return res.status(500).json({ error: "Internal server error" });
    },
  );
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

beforeEach(() => _resetRateLimitBucketsForTests());

async function hit(method: "GET" | "POST", path: string, body?: unknown): Promise<number> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  await res.arrayBuffer(); // drain
  return res.status;
}

/** Hammer `max` times (any status), then assert the next request is 429. */
async function expect429After(
  max: number,
  makePath: (i: number) => string,
  method: "GET" | "POST" = "GET",
  body?: unknown,
): Promise<void> {
  for (let i = 0; i < max; i++) {
    const status = await hit(method, makePath(i), body);
    expect(status).not.toBe(429);
  }
  expect(await hit(method, makePath(max), body)).toBe(429);
}

describe("429 coverage for newly limited routes", () => {
  it("GET /auth/verify-email/:token (10/min, shared across token guesses)", async () => {
    await expect429After(10, (i) => `/auth/verify-email/guess-token-${i}-0123456789abcdef`);
  });

  it("GET /auth/profile-setup/:token (10/min, shared across token guesses)", async () => {
    await expect429After(10, (i) => `/auth/profile-setup/guess-token-${i}-0123456789abcdef`);
  });

  it("GET /event/slug/:slug (60/min)", async () => {
    await expect429After(60, () => `/event/slug/rl-test-nonexistent-slug`);
  });

  it("GET /event/join/:token (10/min, shared across token guesses)", async () => {
    await expect429After(10, (i) => `/event/join/guess-join-${i}-0123456789abcdef`);
  });

  it("GET /cfp/public/:slug (60/min)", async () => {
    await expect429After(60, () => `/cfp/public/rl-test-nonexistent-slug`);
  });

  it("POST /cfp/public/:slug/submit (5/min)", async () => {
    await expect429After(5, () => `/cfp/public/rl-test-nonexistent-slug/submit`, "POST", {});
  });

  it("POST /cfp/public/verify (10/min)", async () => {
    await expect429After(10, () => `/cfp/public/verify`, "POST", { token: "bogus" });
  });

  it("GET /cfp/public/submission (10/min)", async () => {
    await expect429After(10, (i) => `/cfp/public/submission?token=bogus-${i}`);
  });

  it("GET /ics/:token (10/min, shared across token guesses)", async () => {
    await expect429After(10, (i) => `/ics/guess-ics-${i}-0123456789abcdef`);
  });

  it("GET /billing/pricing (60/min)", async () => {
    await expect429After(60, () => `/billing/pricing`);
  });

  it("GET /verify/:certificateId — enumeration shares one bucket (30/min)", async () => {
    // The P4 flaw: previously each guessed ID had its own bucket. Every request
    // here uses a DIFFERENT ID and the 31st must still be 429.
    await expect429After(30, (i) => `/verify/forged-certificate-${i}`);
  });
});

function routeHasRateLimit(
  router: { stack: Array<{ route?: { path?: string; methods?: Record<string, boolean>; stack: Array<{ name?: string }> } }> },
  method: string,
  path: string,
): boolean {
  const layer = router.stack.find(
    (l) => l.route?.path === path && Boolean(l.route?.methods?.[method]),
  );
  return Boolean(layer?.route?.stack.some((h) => h.name === "authRateLimitMiddleware"));
}

describe("authenticated cost/spam surfaces (HARDEN-2)", () => {
  it("mounts a user-keyed limiter after requireAuth on the real routers", () => {
    expect(routeHasRateLimit(conciergeRouter, "post", "/turn")).toBe(true);
    expect(routeHasRateLimit(setupCopilotRouter, "post", "/turn")).toBe(true);
    expect(routeHasRateLimit(setupCopilotRouter, "post", "/document")).toBe(true);
    expect(routeHasRateLimit(conversationsRouter, "post", "/:id/messages")).toBe(true);
  });

  it("POST concierge/setup-copilot chat — 30/min per user, honest 429 body", async () => {
    const app = express();
    app.use(express.json());
    const limit = authRateLimit({
      ...AUTHENTICATED_AI_CHAT_LIMIT,
      name: "harden2-ai-chat",
    });
    const setUser: express.RequestHandler = (req, _res, next) => {
      (req as express.Request & { user?: { id: string } }).user = { id: "user_rl" };
      next();
    };
    app.post("/ai/concierge/turn", setUser, limit, (_req, res) => res.json({ ok: true }));
    app.post("/ai/setup-copilot/turn", setUser, limit, (_req, res) => res.json({ ok: true }));
    app.post("/ai/setup-copilot/document", setUser, limit, (_req, res) => res.json({ ok: true }));

    const srv = await new Promise<Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    try {
      for (let i = 0; i < AUTHENTICATED_AI_CHAT_LIMIT.max; i++) {
        const res = await fetch(`${url}/ai/concierge/turn`, { method: "POST" });
        expect(res.status).not.toBe(429);
        await res.arrayBuffer();
      }
      const over = await fetch(`${url}/ai/setup-copilot/document`, { method: "POST" });
      expect(over.status).toBe(429);
      expect(await over.json()).toEqual({ error: "Too many requests. Try again later." });
    } finally {
      await new Promise<void>((resolve, reject) => srv.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("POST /conversations/:id/messages — 60/min per user, honest 429 body", async () => {
    const app = express();
    app.use(express.json());
    const limit = authRateLimit({
      ...CONVERSATION_MESSAGE_LIMIT,
      name: "harden2-messages",
    });
    const setUser: express.RequestHandler = (req, _res, next) => {
      (req as express.Request & { user?: { id: string } }).user = { id: "user_msg" };
      next();
    };
    app.post("/conversations/:id/messages", setUser, limit, (_req, res) => res.json({ ok: true }));

    const srv = await new Promise<Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    try {
      for (let i = 0; i < CONVERSATION_MESSAGE_LIMIT.max; i++) {
        const res = await fetch(`${url}/conversations/c${i}/messages`, { method: "POST" });
        expect(res.status).not.toBe(429);
        await res.arrayBuffer();
      }
      const over = await fetch(`${url}/conversations/overflow/messages`, { method: "POST" });
      expect(over.status).toBe(429);
      expect(await over.json()).toEqual({ error: "Too many requests. Try again later." });
    } finally {
      await new Promise<void>((resolve, reject) => srv.close((err) => (err ? reject(err) : resolve())));
    }
  });
});
