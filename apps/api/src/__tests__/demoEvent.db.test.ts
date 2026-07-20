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
import { ensureUniqueEventSlug, isReservedEventSlug } from "../lib/slug";
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

  it("refuses reset when the demo slug is held by a non-internal org", async () => {
    if (!dbReady) return;
    const original = await prisma.event.findUniqueOrThrow({
      where: { slug: brand.demoEventSlug },
      select: { id: true, organizationId: true },
    });
    const squatterOrg = await prisma.organization.create({
      data: {
        name: "Slug Squatter Test Org",
        slug: `test-squatter-${Date.now().toString(36)}`,
        plan: "FREE",
      },
    });
    try {
      await prisma.event.update({
        where: { id: original.id },
        data: { organizationId: squatterOrg.id },
      });
      await expect(resetPublicDemoEvent()).rejects.toThrow(/Refusing demo reset/);
      // The squatter's event survived untouched.
      const stillThere = await prisma.event.findUnique({ where: { id: original.id } });
      expect(stillThere?.organizationId).toBe(squatterOrg.id);
    } finally {
      await prisma.event.update({
        where: { id: original.id },
        data: { organizationId: original.organizationId },
      });
      await prisma.organization.delete({ where: { id: squatterOrg.id } });
    }
    // Back under the internal org, reset works again.
    const after = await resetPublicDemoEvent();
    expect(after.eventId).toBe(original.id);
  });

  it("slug generation never yields reserved demo/sample slugs", async () => {
    if (!dbReady) return;
    const demoSlug = await ensureUniqueEventSlug("demo");
    expect(demoSlug).not.toBe(brand.demoEventSlug);
    expect(isReservedEventSlug(demoSlug)).toBe(false);

    const sampleSlug = await ensureUniqueEventSlug("sample-foo");
    expect(sampleSlug).not.toBe("sample-foo");
    expect(sampleSlug.startsWith("sample-")).toBe(false);
    expect(isReservedEventSlug(sampleSlug)).toBe(false);

    // Requesting an exact reserved slug on create/update goes through
    // ensureUniqueEventSlug, so customers can never claim these.
    const exact = await ensureUniqueEventSlug(brand.demoEventSlug);
    expect(isReservedEventSlug(exact)).toBe(false);
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
