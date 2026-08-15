/**
 * M8 — conversation contextSessionId (session context chip): POST /direct accepts
 * optional contextSessionId (validated against this event); GET "/" returns
 * contextSession { id, title } | null. Distinct from reserved sessionId.
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
import { upsertFeatureOverrides } from "../lib/features/featureEnabled";
import { conversationsRouter } from "../routes/conversations";

type ConversationListItem = {
  id: string;
  contextSession?: { id: string; title: string } | null;
  contextSessionId?: string | null;
};

describe("conversation context session chip (DB) — M8", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  const ids: {
    orgId?: string;
    eventId?: string;
    otherEventId?: string;
    userA?: string;
    userB?: string;
    userC?: string;
    session1Id?: string;
    session2Id?: string;
    otherEventSessionId?: string;
  } = {};

  beforeAll(async () => {
    const passwordHash = await hashPassword("TestPass12!x");
    const stamp = Date.now();

    const userA = await prisma.user.create({
      data: {
        email: `ctx-a-${stamp}@example.com`,
        name: "Context A",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const userB = await prisma.user.create({
      data: {
        email: `ctx-b-${stamp}@example.com`,
        name: "Context B",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const userC = await prisma.user.create({
      data: {
        email: `ctx-c-${stamp}@example.com`,
        name: "Context C",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    ids.userA = userA.id;
    ids.userB = userB.id;
    ids.userC = userC.id;

    const org = await prisma.organization.create({
      data: {
        name: `Context Org ${stamp}`,
        slug: `ctx-org-${stamp}`,
        plan: "PRO",
        eventAllowance: 5,
        memberships: { create: { userId: userA.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;
    await applyPlanSkuToOrg(org.id, "pro_monthly");

    const event = await prisma.event.create({
      data: {
        name: `Context Event ${stamp}`,
        slug: `ctx-evt-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2027-09-01T14:00:00Z"),
        endDate: new Date("2027-09-03T22:00:00Z"),
        status: EventStatus.ACTIVE,
        organizationId: org.id,
        createdById: userA.id,
        memberships: {
          create: [
            { userId: userA.id, role: EventMemberRole.ATTENDEE, directoryOptIn: true },
            { userId: userB.id, role: EventMemberRole.ATTENDEE, directoryOptIn: true },
            { userId: userC.id, role: EventMemberRole.ATTENDEE, directoryOptIn: true },
          ],
        },
      },
    });
    ids.eventId = event.id;

    const otherEvent = await prisma.event.create({
      data: {
        name: `Context Other Event ${stamp}`,
        slug: `ctx-other-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2027-10-01T14:00:00Z"),
        endDate: new Date("2027-10-03T22:00:00Z"),
        status: EventStatus.ACTIVE,
        organizationId: org.id,
        createdById: userA.id,
        memberships: {
          create: [{ userId: userA.id, role: EventMemberRole.ATTENDEE, directoryOptIn: true }],
        },
      },
    });
    ids.otherEventId = otherEvent.id;

    await upsertFeatureOverrides(event.id, {
      messaging_dms: true,
    });

    const session1 = await prisma.session.create({
      data: {
        eventId: event.id,
        title: "Opening Keynote",
        startsAt: new Date("2027-09-01T15:00:00Z"),
        endsAt: new Date("2027-09-01T16:00:00Z"),
      },
    });
    const session2 = await prisma.session.create({
      data: {
        eventId: event.id,
        title: "Closing Plenary",
        startsAt: new Date("2027-09-03T15:00:00Z"),
        endsAt: new Date("2027-09-03T16:00:00Z"),
      },
    });
    const otherSession = await prisma.session.create({
      data: {
        eventId: otherEvent.id,
        title: "Other Event Talk",
        startsAt: new Date("2027-10-01T15:00:00Z"),
        endsAt: new Date("2027-10-01T16:00:00Z"),
      },
    });
    ids.session1Id = session1.id;
    ids.session2Id = session2.id;
    ids.otherEventSessionId = otherSession.id;

    const app = express();
    app.use(express.json());
    app.use("/conversations", conversationsRouter);
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
    for (const eventId of [ids.eventId, ids.otherEventId]) {
      if (!eventId) continue;
      await prisma.conversationMessage.deleteMany({ where: { conversation: { eventId } } }).catch(() => null);
      await prisma.conversationMember.deleteMany({ where: { conversation: { eventId } } }).catch(() => null);
      await prisma.conversation.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.session.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.eventFeatureConfig.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.eventMembership.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.event.delete({ where: { id: eventId } }).catch(() => null);
    }
    if (ids.orgId) {
      await prisma.orgMembership.deleteMany({ where: { organizationId: ids.orgId } }).catch(() => null);
      await prisma.organization.delete({ where: { id: ids.orgId } }).catch(() => null);
    }
    for (const id of [ids.userA, ids.userB, ids.userC]) {
      if (id) await prisma.user.delete({ where: { id } }).catch(() => null);
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
      "x-event-id": ids.eventId!,
      "content-type": "application/json",
    };
  }

  async function listAs(userId: string): Promise<ConversationListItem[]> {
    const res = await fetch(`${base}/conversations`, { headers: authHeaders(userId) });
    expect(res.status).toBe(200);
    return (await res.json()) as ConversationListItem[];
  }

  async function createDirect(
    fromUserId: string,
    toUserId: string,
    contextSessionId?: string,
  ) {
    return fetch(`${base}/conversations/direct`, {
      method: "POST",
      headers: authHeaders(fromUserId),
      body: JSON.stringify({
        userId: toUserId,
        ...(contextSessionId ? { contextSessionId } : {}),
      }),
    });
  }

  it(
    "POST /direct with valid contextSessionId → GET shows contextSession {id,title}",
    async () => {
      const res = await createDirect(ids.userA!, ids.userB!, ids.session1Id!);
      expect(res.status).toBe(200);
      const created = (await res.json()) as {
        id: string;
        contextSession?: { id: string; title: string } | null;
      };

      // The POST response itself carries the hydrated chip (no list poll needed).
      expect(created.contextSession).toEqual({
        id: ids.session1Id,
        title: "Opening Keynote",
      });

      const list = await listAs(ids.userA!);
      const row = list.find((c) => c.id === created.id);
      expect(row).toBeTruthy();
      expect(row!.contextSession).toEqual({
        id: ids.session1Id,
        title: "Opening Keynote",
      });
    },
    60_000,
  );

  it(
    "POST /direct with a sessionId from another event → contextSession null",
    async () => {
      const res = await createDirect(ids.userA!, ids.userC!, ids.otherEventSessionId!);
      expect(res.status).toBe(200);
      const created = (await res.json()) as {
        id: string;
        contextSessionId?: string | null;
        contextSession?: { id: string; title: string } | null;
      };

      expect(created.contextSessionId ?? null).toBeNull();
      expect(created.contextSession).toBeNull();

      const list = await listAs(ids.userA!);
      const row = list.find((c) => c.id === created.id);
      expect(row).toBeTruthy();
      expect(row!.contextSession).toBeNull();
    },
    60_000,
  );

  it(
    "re-POST /direct for the same pair with a different valid contextSessionId → updated",
    async () => {
      // A↔B already exists from the first test with session1; refresh to session2.
      const res = await createDirect(ids.userA!, ids.userB!, ids.session2Id!);
      expect(res.status).toBe(200);
      const updated = (await res.json()) as {
        id: string;
        contextSessionId?: string | null;
        contextSession?: { id: string; title: string } | null;
      };
      expect(updated.contextSessionId).toBe(ids.session2Id);

      // Existing-conversation branch also hydrates the chip in the POST response.
      expect(updated.contextSession).toEqual({
        id: ids.session2Id,
        title: "Closing Plenary",
      });

      const list = await listAs(ids.userA!);
      const row = list.find((c) => c.id === updated.id);
      expect(row).toBeTruthy();
      expect(row!.contextSession).toEqual({
        id: ids.session2Id,
        title: "Closing Plenary",
      });
    },
    60_000,
  );

  it(
    "conversation without context → contextSession null",
    async () => {
      // Fresh pair with no contextSessionId in the body.
      const res = await createDirect(ids.userB!, ids.userC!);
      expect(res.status).toBe(200);
      const created = (await res.json()) as { id: string };

      const list = await listAs(ids.userB!);
      const row = list.find((c) => c.id === created.id);
      expect(row).toBeTruthy();
      expect(row!.contextSession).toBeNull();
    },
    60_000,
  );
});
