/**
 * HARDEN-2 — JWT sessionVersion vs the User row requireAuth already loads.
 * Missing claim = 0 so pre-deploy sessions survive; a password event bumps
 * the row and old tokens 401.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import jwt from "jsonwebtoken";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { env } from "../lib/env";
import { signToken } from "../lib/auth";

const state = vi.hoisted(() => ({
  user: {
    id: "user_sv",
    role: "ATTENDEE" as const,
    deactivatedAt: null as Date | null,
    sessionVersion: 0,
  },
}));

vi.mock("../lib/db", () => ({
  prisma: {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        if (where.id !== state.user.id) return null;
        return {
          deactivatedAt: state.user.deactivatedAt,
          role: state.user.role,
          sessionVersion: state.user.sessionVersion,
        };
      },
    },
  },
}));

import { requireAuth } from "../lib/middleware";

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.get("/probe", requireAuth, (req, res) => {
    res.json({ ok: true, userId: (req as express.Request & { user?: { id: string } }).user?.id });
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
  state.user.sessionVersion = 0;
  state.user.deactivatedAt = null;
});

async function probe(token: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${base}/probe`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: await res.json() };
}

describe("sessionVersion (HARDEN-2)", () => {
  it("old token 401s after reset (row bumped)", async () => {
    const issued = signToken({
      userId: state.user.id,
      role: state.user.role,
      sessionVersion: 0,
    });
    expect((await probe(issued)).status).toBe(200);

    // Password-reset completion increments the row.
    state.user.sessionVersion = 1;
    const after = await probe(issued);
    expect(after.status).toBe(401);
    expect(after.body).toEqual({ error: "Unauthorized" });
  });

  it("token issued after reset works", async () => {
    state.user.sessionVersion = 1;
    const fresh = signToken({
      userId: state.user.id,
      role: state.user.role,
      sessionVersion: 1,
    });
    const hit = await probe(fresh);
    expect(hit.status).toBe(200);
    expect(hit.body).toEqual({ ok: true, userId: state.user.id });
  });

  it("legacy claimless token is still accepted when version is 0", async () => {
    const legacy = jwt.sign(
      { userId: state.user.id, role: state.user.role },
      env.jwtSecret,
      { expiresIn: "7d" },
    );
    expect(jwt.decode(legacy) as { sessionVersion?: number }).not.toHaveProperty("sessionVersion");
    expect((await probe(legacy)).status).toBe(200);

    state.user.sessionVersion = 1;
    expect((await probe(legacy)).status).toBe(401);
  });
});
