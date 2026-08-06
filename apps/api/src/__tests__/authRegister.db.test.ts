/**
 * E1.1 — registration email fallback: when the email provider reports
 * delivered=false (unconfigured), the register response includes the verify
 * URL + emailDeliveryUnavailable so the UI can unblock the user; when
 * delivery succeeded the verify URL is never returned.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync } from "fs";
import { resolve } from "path";
import dotenv from "dotenv";

for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
  if (existsSync(p)) dotenv.config({ path: p });
}

const mailState = vi.hoisted(() => ({ delivered: false }));

vi.mock("../lib/mail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/mail")>();
  return {
    ...actual,
    sendEmailVerificationEmail: vi.fn(async (opts: { verifyUrl: string }) =>
      mailState.delivered
        ? { delivered: true }
        : { delivered: false, copyUrl: opts.verifyUrl, fallbackMessage: "unconfigured" },
    ),
  };
});

import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { PrismaClient } from "@prisma/client";
import { authRouter } from "../routes/auth";

describe("POST /auth/register email fallback (DB)", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  const createdEmails: string[] = [];

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use("/auth", authRouter);
    app.use(
      (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        const httpErr = err as { status?: number; body?: Record<string, unknown> };
        if (typeof httpErr?.status === "number" && httpErr.body) {
          return res.status(httpErr.status).json(httpErr.body);
        }
        return res.status(500).json({ error: "Internal server error" });
      },
    );
    await new Promise<void>((resolveListen) => {
      server = app.listen(0, "127.0.0.1", resolveListen);
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (createdEmails.length) {
      await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    }
    await prisma.$disconnect();
    if (server) {
      await new Promise<void>((resolveClose, reject) =>
        server.close((err) => (err ? reject(err) : resolveClose())),
      );
    }
  });

  async function register(email: string): Promise<{ status: number; body: Record<string, unknown> }> {
    createdEmails.push(email);
    const res = await fetch(`${base}/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, name: "Reg Test", password: "Str0ng!Passw0rd#2026" }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    return { status: res.status, body };
  }

  it("unconfigured provider → response includes verifyUrl + emailDeliveryUnavailable", async () => {
    mailState.delivered = false;
    const { status, body } = await register(`reg-fallback-${Date.now()}@example.com`);
    expect(status).toBe(201);
    expect(body.emailDeliveryUnavailable).toBe(true);
    expect(String(body.verifyUrl)).toMatch(/\/verify-email\/.{16,}/);
  });

  it("configured provider (delivered) → response never includes verifyUrl", async () => {
    mailState.delivered = true;
    const { status, body } = await register(`reg-delivered-${Date.now()}@example.com`);
    expect(status).toBe(201);
    expect(body.requiresEmailVerification).toBe(true);
    expect(body).not.toHaveProperty("verifyUrl");
    expect(body).not.toHaveProperty("emailDeliveryUnavailable");
  });
});
