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
  DEMO_PRESENTER_PORTAL_TOKEN,
  DEMO_PRESENTER_PORTAL_TOKEN_2,
  clearDemoEventIdCache,
  getDemoEventId,
  resetPublicDemoEvent,
} from "../lib/demoEvent";
import { DEMO_EXPLORERS } from "../lib/demoEvent/fixture";
import { hashToken, verifyPassword } from "../lib/auth";
import { getPublicEventBySlug } from "../lib/publicEvent";
import { rejectDemoMutations } from "../lib/demoEvent/middleware";
import { ensureUniqueEventSlug, isReservedEventSlug } from "../lib/slug";
import type { Request, Response } from "express";

const EXPLORER_EMAILS = DEMO_EXPLORERS.map((explorer) => explorer.email);

async function deleteDemoOnlyExplorerUsers(client: PrismaClient): Promise<void> {
  const users = await client.user.findMany({
    where: { email: { in: [...EXPLORER_EMAILS] } },
    select: { id: true },
  });
  for (const user of users) {
    const [orgMemberships, foreignMemberships, foreignAttendance] = await Promise.all([
      client.orgMembership.count({ where: { userId: user.id } }),
      client.eventMembership.count({
        where: { userId: user.id, event: { slug: { not: brand.demoEventSlug } } },
      }),
      client.sessionAttendance.count({
        where: { userId: user.id, session: { event: { slug: { not: brand.demoEventSlug } } } },
      }),
    ]);
    if (orgMemberships > 0 || foreignMemberships > 0 || foreignAttendance > 0) {
      throw new Error(
        `Refusing to delete user ${user.id} during explorer reset test: account has data outside the demo event.`,
      );
    }
    await client.user.delete({ where: { id: user.id } });
  }
}

describe("Phase 6 demo event (DB)", () => {
  const prisma = new PrismaClient();
  let eventId = "";

  beforeAll(async () => {
    clearDemoEventIdCache();
    const first = await resetPublicDemoEvent();
    eventId = first.eventId;
    // A full reset on the network test branch is about 90s. The 10s default
    // hook timeout can't fit it (same pattern as recap.db.test.ts).
  }, 180_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("public GET works anonymously via getPublicEventBySlug", async () => {
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
    const a = await resetPublicDemoEvent();
    const b = await resetPublicDemoEvent();
    expect(a.slug).toBe(brand.demoEventSlug);
    expect(b.slug).toBe(brand.demoEventSlug);
    expect(a.eventId).toBe(b.eventId);
    expect(await prisma.event.count({ where: { slug: brand.demoEventSlug } })).toBe(1);
    const sessions = await prisma.session.count({ where: { eventId: a.eventId } });
    expect(sessions).toBeGreaterThan(0);
  }, 240_000);

  it("demo POST/PATCH/DELETE targeting demo id → 403 DEMO_READ_ONLY", async () => {
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
  }, 180_000);

  it("slug generation never yields reserved demo/sample slugs", async () => {
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

  it("mints stable presenter portal links for Maya Chen and Jonas Okonkwo", async () => {
    const accesses = await prisma.readinessPortalAccess.findMany({
      where: { eventId },
      select: { tokenHash: true, speaker: { select: { name: true } } },
    });
    const byName = new Map(accesses.map((row) => [row.speaker.name, row.tokenHash]));
    expect(byName.get("Maya Chen")).toBe(hashToken(DEMO_PRESENTER_PORTAL_TOKEN));
    expect(byName.get("Jonas Okonkwo")).toBe(hashToken(DEMO_PRESENTER_PORTAL_TOKEN_2));
    expect(byName.get("Maya Chen")).not.toBe(byName.get("Jonas Okonkwo"));
  });

  it("creates explorer accounts only when DEMO_EXPLORER_PASSWORD is set", async () => {
    const previous = process.env.DEMO_EXPLORER_PASSWORD;
    const logged: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logged.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
      originalLog(...args);
    };
    const password = "ExplorerTest.pass.1";
    const nextPassword = "ExplorerTest.pass.2";
    const assertSecretAbsent = (secret: string) => {
      if (logged.some((line) => line.includes(secret))) {
        throw new Error("Explorer password was written to a log line.");
      }
    };
    try {
      delete process.env.DEMO_EXPLORER_PASSWORD;
      await deleteDemoOnlyExplorerUsers(prisma);
      await resetPublicDemoEvent();
      expect(
        await prisma.user.count({ where: { email: { in: [...EXPLORER_EMAILS] } } }),
      ).toBe(0);
      expect(logged.some((line) => line.includes("skipping explorer accounts"))).toBe(true);

      process.env.DEMO_EXPLORER_PASSWORD = password;
      const seeded = await resetPublicDemoEvent();
      const keynote = await prisma.session.findFirstOrThrow({
        where: { eventId: seeded.eventId, title: { startsWith: "Opening keynote" } },
        select: { id: true },
      });
      const users = await prisma.user.findMany({
        where: { email: { in: [...EXPLORER_EMAILS] } },
        include: { orgMemberships: true, eventMemberships: true, sessionAttendances: true },
      });
      expect(users).toHaveLength(2);
      for (const explorer of DEMO_EXPLORERS) {
        const user = users.find((row) => row.email === explorer.email);
        expect(user, explorer.email).toBeTruthy();
        expect(user!.name).toBe(explorer.name);
        expect(user!.title).toBe(explorer.title);
        expect(user!.affiliation).toBe(explorer.affiliation);
        expect(user!.emailVerifiedAt).not.toBeNull();
        expect(user!.orgMemberships).toHaveLength(0);
        expect(await verifyPassword(password, user!.passwordHash)).toBe(true);
        const membership = user!.eventMemberships.find((row) => row.eventId === seeded.eventId);
        expect(membership?.role).toBe("ATTENDEE");
        expect(membership?.directoryOptIn).toBe(true);
        expect(membership?.welcomeSeenAt).not.toBeNull();
        const join = user!.sessionAttendances.find((row) => row.sessionId === keynote.id);
        expect(join?.status).toBe("JOINING");
        expect(join?.joinMode).toBe("IN_PERSON");
      }

      process.env.DEMO_EXPLORER_PASSWORD = nextPassword;
      await resetPublicDemoEvent();
      const rehashed = await prisma.user.findMany({
        where: { email: { in: [...EXPLORER_EMAILS] } },
        select: { passwordHash: true },
      });
      expect(rehashed).toHaveLength(2);
      for (const user of rehashed) {
        expect(await verifyPassword(nextPassword, user.passwordHash)).toBe(true);
        expect(await verifyPassword(password, user.passwordHash)).toBe(false);
      }
      assertSecretAbsent(password);
      assertSecretAbsent(nextPassword);
    } finally {
      console.log = originalLog;
      if (previous === undefined) delete process.env.DEMO_EXPLORER_PASSWORD;
      else process.env.DEMO_EXPLORER_PASSWORD = previous;
      if (process.env.DEMO_EXPLORER_PASSWORD) {
        await resetPublicDemoEvent();
      } else {
        await deleteDemoOnlyExplorerUsers(prisma);
      }
    }
  }, 480_000);
});
