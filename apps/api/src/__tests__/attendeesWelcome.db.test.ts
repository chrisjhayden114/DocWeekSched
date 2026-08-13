/**
 * ONB-A — attendee first-run welcomeSeenAt on EventMembership.
 * Skip and finish both stamp; a second POST is a no-op.
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
import { applyPlanSkuToOrg } from "../lib/billing/entitlements";
import { attendeesRouter } from "../routes/attendees";

type MeBody = {
  directoryOptIn: boolean;
  role: string;
  welcomeSeenAt: string | null;
};

describe("attendee welcome seen (DB)", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  const ids: {
    orgId?: string;
    eventId?: string;
    ownerId?: string;
    attendeeId?: string;
  } = {};

  beforeAll(async () => {
    const passwordHash = await hashPassword("TestPass12!x");
    const stamp = Date.now();

    const owner = await prisma.user.create({
      data: {
        email: `onba-owner-${stamp}@example.com`,
        name: "Welcome Owner",
        role: "ADMIN",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const attendee = await prisma.user.create({
      data: {
        email: `onba-att-${stamp}@example.com`,
        name: "Welcome Attendee",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    ids.ownerId = owner.id;
    ids.attendeeId = attendee.id;

    const org = await prisma.organization.create({
      data: {
        name: `Welcome Org ${stamp}`,
        slug: `onba-org-${stamp}`,
        plan: "PRO",
        eventAllowance: 5,
        memberships: { create: { userId: owner.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;
    await applyPlanSkuToOrg(org.id, "pro_monthly");

    const event = await prisma.event.create({
      data: {
        name: `Welcome Event ${stamp}`,
        slug: `onba-evt-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2027-11-01T14:00:00Z"),
        endDate: new Date("2027-11-03T22:00:00Z"),
        status: EventStatus.ACTIVE,
        organizationId: org.id,
        createdById: owner.id,
        memberships: {
          create: [
            { userId: owner.id, role: EventMemberRole.ADMIN },
            { userId: attendee.id, role: EventMemberRole.ATTENDEE },
          ],
        },
      },
    });
    ids.eventId = event.id;

    const app = express();
    app.use(express.json());
    app.use("/attendees", attendeesRouter);
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
    const eventId = ids.eventId;
    if (eventId) {
      await prisma.eventMembership.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.event.delete({ where: { id: eventId } }).catch(() => null);
    }
    if (ids.orgId) {
      await prisma.orgMembership.deleteMany({ where: { organizationId: ids.orgId } }).catch(() => null);
      await prisma.organization.delete({ where: { id: ids.orgId } }).catch(() => null);
    }
    for (const userId of [ids.ownerId, ids.attendeeId]) {
      if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => null);
    }
    await prisma.$disconnect();
    if (server) {
      await new Promise<void>((resolveClose, reject) =>
        server.close((err) => (err ? reject(err) : resolveClose())),
      );
    }
  }, 60_000);

  function authHeaders() {
    const token = signToken({ userId: ids.attendeeId!, role: "ATTENDEE" });
    return {
      authorization: `Bearer ${token}`,
      "x-event-id": ids.eventId!,
      "content-type": "application/json",
    };
  }

  async function getMe() {
    const res = await fetch(`${base}/attendees/me`, { headers: authHeaders() });
    const body = (await res.json()) as MeBody;
    return { status: res.status, body };
  }

  async function postWelcomeSeen() {
    const res = await fetch(`${base}/attendees/me/welcome-seen`, {
      method: "POST",
      headers: authHeaders(),
    });
    const body = (await res.json()) as { welcomeSeenAt: string };
    return { status: res.status, body };
  }

  it("fresh membership has welcomeSeenAt null and directoryOptIn false", async () => {
    const { status, body } = await getMe();
    expect(status).toBe(200);
    expect(body.welcomeSeenAt).toBeNull();
    expect(body.directoryOptIn).toBe(false);
    expect(body.role).toBe("ATTENDEE");
  }, 60_000);

  it("POST /welcome-seen stamps once; second POST is idempotent; directory stays off", async () => {
    const first = await postWelcomeSeen();
    expect(first.status).toBe(200);
    expect(typeof first.body.welcomeSeenAt).toBe("string");
    expect(Number.isNaN(Date.parse(first.body.welcomeSeenAt))).toBe(false);

    const after = await getMe();
    expect(after.status).toBe(200);
    expect(after.body.welcomeSeenAt).toBe(first.body.welcomeSeenAt);
    expect(after.body.directoryOptIn).toBe(false);

    const second = await postWelcomeSeen();
    expect(second.status).toBe(200);
    expect(second.body.welcomeSeenAt).toBe(first.body.welcomeSeenAt);

    const still = await getMe();
    expect(still.body.directoryOptIn).toBe(false);
    expect(still.body.welcomeSeenAt).toBe(first.body.welcomeSeenAt);
  }, 60_000);
});
