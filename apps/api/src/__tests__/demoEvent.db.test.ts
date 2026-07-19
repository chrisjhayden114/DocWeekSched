/**
 * Phase 6 Chunk C — public demo event (DB).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "fs";
import { resolve } from "path";
import dotenv from "dotenv";

for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
  if (existsSync(p)) dotenv.config({ path: p });
}

import { brand } from "@event-app/config";
import { PrismaClient } from "@prisma/client";
import {
  clearDemoEventIdCache,
  getDemoEventId,
  resetPublicDemoEvent,
} from "../lib/demoEvent";
import { getPublicEventBySlug } from "../lib/publicEvent";
import { rejectDemoMutations } from "../lib/demoEvent/middleware";
import type { Request, Response } from "express";

describe("Phase 6 demo event (DB)", () => {
  const prisma = new PrismaClient();
  let dbReady = false;
  let eventId = "";

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReady = true;
    } catch {
      console.warn("[demoEvent.db.test] DATABASE_URL unreachable — skipping");
      return;
    }
    clearDemoEventIdCache();
    const first = await resetPublicDemoEvent();
    eventId = first.eventId;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("public GET works anonymously via getPublicEventBySlug", async () => {
    if (!dbReady) return;
    const payload = await getPublicEventBySlug(brand.demoEventSlug);
    expect(payload).not.toBeNull();
    expect(payload!.slug).toBe(brand.demoEventSlug);
    expect(payload!.sessions.length).toBeGreaterThan(0);
    expect(payload!.speakers.length).toBeGreaterThan(0);
    expect(payload!.sponsors.length).toBeGreaterThan(0);
    const withPapers = payload!.sessions.some((s) => s.items.length > 0);
    expect(withPapers).toBe(true);
  });

  it("nightly reset is idempotent", async () => {
    if (!dbReady) return;
    const a = await resetPublicDemoEvent();
    const b = await resetPublicDemoEvent();
    expect(a.slug).toBe(brand.demoEventSlug);
    expect(b.slug).toBe(brand.demoEventSlug);
    expect(a.eventId).toBe(b.eventId);
    expect(await prisma.event.count({ where: { slug: brand.demoEventSlug } })).toBe(1);
    const sessions = await prisma.session.count({ where: { eventId: a.eventId } });
    expect(sessions).toBeGreaterThan(0);
  });

  it("demo POST/PATCH/DELETE targeting demo id → 403 DEMO_READ_ONLY", async () => {
    if (!dbReady) return;
    clearDemoEventIdCache();
    const id = await getDemoEventId();
    expect(id).toBe(eventId);

    for (const method of ["POST", "PATCH", "DELETE"] as const) {
      let status = 0;
      let body: { code?: string } = {};
      const req = {
        method,
        headers: { "x-event-id": id! },
        params: {},
        body: {},
        originalUrl: "/sessions",
        url: "/sessions",
      } as unknown as Request;
      const res = {
        status(code: number) {
          status = code;
          return this;
        },
        json(payload: { code?: string }) {
          body = payload;
          return this;
        },
      } as unknown as Response;
      let nextCalled = false;
      await rejectDemoMutations(req, res, () => {
        nextCalled = true;
      });
      expect(nextCalled).toBe(false);
      expect(status).toBe(403);
      expect(body.code).toBe("DEMO_READ_ONLY");
    }
  });

  it("GET requests are not blocked by demo middleware", async () => {
    if (!dbReady) return;
    const id = await getDemoEventId();
    let nextCalled = false;
    const req = {
      method: "GET",
      headers: { "x-event-id": id! },
      params: {},
      body: {},
      originalUrl: "/event",
      url: "/event",
    } as unknown as Request;
    const res = {} as Response;
    await rejectDemoMutations(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
  });
});
