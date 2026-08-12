/**
 * GET /event/mine — plain ATTENDEE EventMembership must surface the event
 * after login (no org membership / no ADMIN role required); soft-deleted
 * memberships must not.
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
import { eventRouter } from "../routes/event";

type MineEvent = { id: string };

describe("GET /event/mine attendee memberships (DB)", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  const ids: {
    orgId?: string;
    eventId?: string;
    ownerId?: string;
    attendeeId?: string;
    softDeletedAttendeeId?: string;
    unrelatedId?: string;
    softMembershipId?: string;
  } = {};

  beforeAll(async () => {
    const passwordHash = await hashPassword("TestPass12!x");
    const stamp = Date.now();

    const owner = await prisma.user.create({
      data: {
        email: `emine-owner-${stamp}@example.com`,
        name: "Mine Owner",
        role: "ADMIN",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const attendee = await prisma.user.create({
      data: {
        email: `emine-att-${stamp}@example.com`,
        name: "Mine Attendee",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const softDeletedAttendee = await prisma.user.create({
      data: {
        email: `emine-soft-${stamp}@example.com`,
        name: "Mine Soft Deleted",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const unrelated = await prisma.user.create({
      data: {
        email: `emine-unrel-${stamp}@example.com`,
        name: "Mine Unrelated",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    ids.ownerId = owner.id;
    ids.attendeeId = attendee.id;
    ids.softDeletedAttendeeId = softDeletedAttendee.id;
    ids.unrelatedId = unrelated.id;

    const org = await prisma.organization.create({
      data: {
        name: `Mine Org ${stamp}`,
        slug: `emine-org-${stamp}`,
        plan: "PRO",
        eventAllowance: 5,
        memberships: { create: { userId: owner.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;
    await applyPlanSkuToOrg(org.id, "pro_monthly");

    const event = await prisma.event.create({
      data: {
        name: `Mine Event ${stamp}`,
        slug: `emine-evt-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2027-10-01T14:00:00Z"),
        endDate: new Date("2027-10-03T22:00:00Z"),
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

    const softMembership = await prisma.eventMembership.create({
      data: {
        eventId: event.id,
        userId: softDeletedAttendee.id,
        role: EventMemberRole.ATTENDEE,
        deletedAt: new Date(),
      },
    });
    ids.softMembershipId = softMembership.id;

    const app = express();
    app.use(express.json());
    app.use("/event", eventRouter);
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
    for (const userId of [ids.ownerId, ids.attendeeId, ids.softDeletedAttendeeId, ids.unrelatedId]) {
      if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => null);
    }
    await prisma.$disconnect();
    if (server) {
      await new Promise<void>((resolveClose, reject) =>
        server.close((err) => (err ? reject(err) : resolveClose())),
      );
    }
  }, 60_000);

  function authHeaders(userId: string) {
    const token = signToken({ userId, role: "ATTENDEE" });
    return {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };
  }

  async function mineAs(userId: string): Promise<{ status: number; events: MineEvent[] }> {
    const res = await fetch(`${base}/event/mine`, { headers: authHeaders(userId) });
    const body = (await res.json()) as MineEvent[];
    return { status: res.status, events: body };
  }

  it(
    "plain ATTENDEE membership returns the event; soft-deleted does not; unrelated gets empty",
    async () => {
      const attendee = await mineAs(ids.attendeeId!);
      expect(attendee.status).toBe(200);
      expect(attendee.events.map((e) => e.id)).toEqual([ids.eventId]);

      const soft = await mineAs(ids.softDeletedAttendeeId!);
      expect(soft.status).toBe(200);
      expect(soft.events).toEqual([]);

      const unrelated = await mineAs(ids.unrelatedId!);
      expect(unrelated.status).toBe(200);
      expect(unrelated.events).toEqual([]);
    },
    60_000,
  );
});
