/**
 * ACCT-1 — account-level NotificationPreference PUT writes the eventId-null
 * row. Event GET already falls back to it; this is additive (no migration).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "fs";
import { resolve } from "path";
import dotenv from "dotenv";

for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
  if (existsSync(p)) dotenv.config({ path: p });
}

import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { EventMemberRole, EventStatus, OrgRole, PrismaClient } from "@prisma/client";
import { hashPassword, signToken } from "../lib/auth";
import { notificationsRouter } from "../routes/notifications";

type PrefsBody = {
  digestEmail: boolean;
  messageEmail: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
};

describe("account-level notification preference PUT (DB)", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  const ids: { orgId?: string; eventId?: string; userId?: string; otherUserId?: string } = {};

  beforeAll(async () => {
    const passwordHash = await hashPassword("TestPass12!x");
    const stamp = Date.now();

    const user = await prisma.user.create({
      data: {
        email: `acct-pref-${stamp}@example.com`,
        name: "Acct Pref",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const other = await prisma.user.create({
      data: {
        email: `acct-pref-other-${stamp}@example.com`,
        name: "Acct Other",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    ids.userId = user.id;
    ids.otherUserId = other.id;

    const org = await prisma.organization.create({
      data: {
        name: `Acct Pref Org ${stamp}`,
        slug: `acct-pref-org-${stamp}`,
        plan: "FREE",
        memberships: { create: { userId: user.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;

    const event = await prisma.event.create({
      data: {
        name: `Acct Pref Event ${stamp}`,
        slug: `acct-pref-evt-${stamp}`,
        timezone: "America/New_York",
        startDate: new Date("2027-06-01T14:00:00Z"),
        endDate: new Date("2027-06-03T22:00:00Z"),
        status: EventStatus.ACTIVE,
        organizationId: org.id,
        createdById: user.id,
        memberships: {
          create: { userId: user.id, role: EventMemberRole.ATTENDEE },
        },
      },
    });
    ids.eventId = event.id;

    const app = express();
    app.use(express.json());
    app.use("/notifications", notificationsRouter);
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
  }, 60_000);

  afterAll(async () => {
    if (ids.userId) {
      await prisma.notificationPreference.deleteMany({ where: { userId: ids.userId } }).catch(() => null);
    }
    if (ids.eventId) {
      await prisma.eventMembership.deleteMany({ where: { eventId: ids.eventId } }).catch(() => null);
      await prisma.event.delete({ where: { id: ids.eventId } }).catch(() => null);
    }
    if (ids.orgId) {
      await prisma.orgMembership.deleteMany({ where: { organizationId: ids.orgId } }).catch(() => null);
      await prisma.organization.delete({ where: { id: ids.orgId } }).catch(() => null);
    }
    for (const userId of [ids.userId, ids.otherUserId]) {
      if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => null);
    }
    await prisma.$disconnect();
    if (server) {
      await new Promise<void>((resolveClose, reject) =>
        server.close((err) => (err ? reject(err) : resolveClose())),
      );
    }
  }, 60_000);

  function authHeaders(userId: string, extra: Record<string, string> = {}) {
    return {
      authorization: `Bearer ${signToken({ userId, role: "ATTENDEE" })}`,
      "content-type": "application/json",
      ...extra,
    };
  }

  it("PUT /preferences/account creates the eventId-null row and needs no event header", async () => {
    const res = await fetch(`${base}/notifications/preferences/account`, {
      method: "PUT",
      headers: authHeaders(ids.userId!),
      body: JSON.stringify({
        digestEmail: true,
        messageEmail: false,
        quietHoursStart: "21:00",
        quietHoursEnd: "06:30",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PrefsBody;
    expect(body.digestEmail).toBe(true);
    expect(body.messageEmail).toBe(false);
    expect(body.quietHoursStart).toBe("21:00");
    expect(body.quietHoursEnd).toBe("06:30");

    const rows = await prisma.notificationPreference.findMany({
      where: { userId: ids.userId! },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.eventId).toBeNull();
    expect(rows[0]!.digestEmail).toBe(true);
    expect(rows[0]!.messageEmail).toBe(false);
  });

  it("GET /preferences (event) falls back to the account row when no event override exists", async () => {
    const res = await fetch(`${base}/notifications/preferences`, {
      headers: authHeaders(ids.userId!, { "x-event-id": ids.eventId! }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PrefsBody;
    expect(body.digestEmail).toBe(true);
    expect(body.messageEmail).toBe(false);
    expect(body.quietHoursStart).toBe("21:00");
  });

  it("a second PUT updates the same global row and does not create an event row", async () => {
    const res = await fetch(`${base}/notifications/preferences/account`, {
      method: "PUT",
      headers: authHeaders(ids.userId!),
      body: JSON.stringify({ digestEmail: false }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PrefsBody;
    expect(body.digestEmail).toBe(false);
    expect(body.messageEmail).toBe(false);

    const rows = await prisma.notificationPreference.findMany({
      where: { userId: ids.userId! },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.eventId).toBeNull();
    expect(rows[0]!.digestEmail).toBe(false);
  });

  it("GET /preferences/account returns the global row without an event header", async () => {
    const res = await fetch(`${base}/notifications/preferences/account`, {
      headers: authHeaders(ids.userId!),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PrefsBody;
    expect(body.digestEmail).toBe(false);
    expect(body.messageEmail).toBe(false);
  });
});
