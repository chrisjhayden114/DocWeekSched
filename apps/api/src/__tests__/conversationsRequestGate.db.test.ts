/**
 * M4b — message request gate (flag: messaging_requests): stranger DMs land as
 * silent REQUESTED threads (one message, no notify/unread) until the recipient
 * replies; organizers are exempt; flag-off preserves ACTIVE + notify.
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
import { EventMemberRole, EventStatus, NotificationKind, OrgRole, PrismaClient } from "@prisma/client";
import { hashPassword, signToken } from "../lib/auth";
import { applyPlanSkuToOrg } from "../lib/billing/entitlements";
import { upsertFeatureOverrides } from "../lib/features/featureEnabled";
import { REQUEST_FIRST_MESSAGE_MAX } from "../lib/requestGate";
import { conversationsRouter } from "../routes/conversations";

type ConversationListItem = {
  id: string;
  status?: string;
  initiatedByMe?: boolean;
  unread?: boolean;
};

describe("conversation request gate (DB) — messaging_requests on", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  const ids: {
    orgId?: string;
    eventId?: string;
    userA?: string;
    userB?: string;
    userC?: string;
    userAdmin?: string;
  } = {};

  beforeAll(async () => {
    const passwordHash = await hashPassword("TestPass12!x");
    const stamp = Date.now();

    const userA = await prisma.user.create({
      data: {
        email: `crq-a-${stamp}@example.com`,
        name: "Request A",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const userB = await prisma.user.create({
      data: {
        email: `crq-b-${stamp}@example.com`,
        name: "Request B",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const userC = await prisma.user.create({
      data: {
        email: `crq-c-${stamp}@example.com`,
        name: "Request C",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const userAdmin = await prisma.user.create({
      data: {
        email: `crq-admin-${stamp}@example.com`,
        name: "Request Admin",
        role: "ADMIN",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    ids.userA = userA.id;
    ids.userB = userB.id;
    ids.userC = userC.id;
    ids.userAdmin = userAdmin.id;

    const org = await prisma.organization.create({
      data: {
        name: `Request Org ${stamp}`,
        slug: `crq-org-${stamp}`,
        plan: "PRO",
        eventAllowance: 5,
        memberships: { create: { userId: userAdmin.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;
    await applyPlanSkuToOrg(org.id, "pro_monthly");

    const event = await prisma.event.create({
      data: {
        name: `Request Event ${stamp}`,
        slug: `crq-evt-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2027-09-01T14:00:00Z"),
        endDate: new Date("2027-09-03T22:00:00Z"),
        status: EventStatus.ACTIVE,
        organizationId: org.id,
        createdById: userAdmin.id,
        memberships: {
          create: [
            { userId: userA.id, role: EventMemberRole.ATTENDEE, directoryOptIn: true },
            { userId: userB.id, role: EventMemberRole.ATTENDEE, directoryOptIn: true },
            { userId: userC.id, role: EventMemberRole.ATTENDEE, directoryOptIn: true },
            { userId: userAdmin.id, role: EventMemberRole.ADMIN, directoryOptIn: true },
          ],
        },
      },
    });
    ids.eventId = event.id;

    await upsertFeatureOverrides(event.id, {
      messaging_dms: true,
      messaging_requests: true,
    });

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
    const eventId = ids.eventId;
    if (eventId) {
      await prisma.userNotification.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.conversationMessage.deleteMany({ where: { conversation: { eventId } } }).catch(() => null);
      await prisma.conversationMember.deleteMany({ where: { conversation: { eventId } } }).catch(() => null);
      await prisma.conversation.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.eventFeatureConfig.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.eventMembership.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.event.delete({ where: { id: eventId } }).catch(() => null);
    }
    if (ids.orgId) {
      await prisma.orgMembership.deleteMany({ where: { organizationId: ids.orgId } }).catch(() => null);
      await prisma.organization.delete({ where: { id: ids.orgId } }).catch(() => null);
    }
    for (const id of [ids.userA, ids.userB, ids.userC, ids.userAdmin]) {
      if (id) await prisma.user.delete({ where: { id } }).catch(() => null);
    }
    await prisma.$disconnect();
    if (server) {
      await new Promise<void>((resolveClose, reject) =>
        server.close((err) => (err ? reject(err) : resolveClose())),
      );
    }
  });

  function authHeaders(userId: string, role: "ATTENDEE" | "ADMIN" = "ATTENDEE") {
    const token = signToken({ userId, role });
    return {
      authorization: `Bearer ${token}`,
      "x-event-id": ids.eventId!,
      "content-type": "application/json",
    };
  }

  async function listAs(userId: string, role: "ATTENDEE" | "ADMIN" = "ATTENDEE") {
    const res = await fetch(`${base}/conversations`, { headers: authHeaders(userId, role) });
    expect(res.status).toBe(200);
    return (await res.json()) as ConversationListItem[];
  }

  async function createDirect(fromUserId: string, toUserId: string, role: "ATTENDEE" | "ADMIN" = "ATTENDEE") {
    const res = await fetch(`${base}/conversations/direct`, {
      method: "POST",
      headers: authHeaders(fromUserId, role),
      body: JSON.stringify({ userId: toUserId }),
    });
    return res;
  }

  async function sendAs(userId: string, conversationId: string, body: string, role: "ATTENDEE" | "ADMIN" = "ATTENDEE") {
    return fetch(`${base}/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: authHeaders(userId, role),
      body: JSON.stringify({ body }),
    });
  }

  it(
    "attendee DM is REQUESTED + silent; one message until reply accepts; empty requests hidden; admin exempt",
    async () => {
      // A creates a DM to B → REQUESTED, initiatedById = A.
      const createRes = await createDirect(ids.userA!, ids.userB!);
      expect(createRes.status).toBe(200);
      const created = (await createRes.json()) as { id: string; status: string; initiatedById: string | null };
      expect(created.status).toBe("REQUESTED");
      expect(created.initiatedById).toBe(ids.userA);
      const abId = created.id;

      // A sends first message → 200. No MESSAGE notification for B.
      const firstSend = await sendAs(ids.userA!, abId, "Hello B, nice to meet you");
      expect(firstSend.status).toBe(200);
      const notifyForB = await prisma.userNotification.count({
        where: {
          eventId: ids.eventId!,
          userId: ids.userB!,
          conversationId: abId,
          kind: NotificationKind.MESSAGE,
        },
      });
      expect(notifyForB).toBe(0);

      // B's GET includes the request with status REQUESTED, unread false.
      const asB = await listAs(ids.userB!);
      const rowB = asB.find((c) => c.id === abId);
      expect(rowB).toBeTruthy();
      expect(rowB!.status).toBe("REQUESTED");
      expect(rowB!.initiatedByMe).toBe(false);
      expect(rowB!.unread).toBe(false);

      // A's second send → 403 waiting for reply.
      const secondSend = await sendAs(ids.userA!, abId, "Following up");
      expect(secondSend.status).toBe(403);
      expect(await secondSend.json()).toEqual({
        error: "Waiting for a reply. You can send another message once they respond.",
      });

      // Char cap on first message of a fresh A→C request.
      const acCreate = await createDirect(ids.userA!, ids.userC!);
      expect(acCreate.status).toBe(200);
      const ac = (await acCreate.json()) as { id: string; status: string };
      expect(ac.status).toBe("REQUESTED");

      // Empty-request hiding: C does not see A→C yet; A does.
      const asCEmpty = await listAs(ids.userC!);
      expect(asCEmpty.find((c) => c.id === ac.id)).toBeUndefined();
      const asAWithEmpty = await listAs(ids.userA!);
      expect(asAWithEmpty.find((c) => c.id === ac.id)).toBeTruthy();

      const tooLong = await sendAs(ids.userA!, ac.id, "x".repeat(REQUEST_FIRST_MESSAGE_MAX + 1));
      expect(tooLong.status).toBe(400);
      expect(await tooLong.json()).toEqual({
        error: `Keep your first message under ${REQUEST_FIRST_MESSAGE_MAX} characters.`,
      });

      // B replies → 200; conversation ACTIVE; A gets a MESSAGE notification; A can send again.
      const reply = await sendAs(ids.userB!, abId, "Hi A — happy to chat");
      expect(reply.status).toBe(200);
      const afterReply = await prisma.conversation.findUniqueOrThrow({ where: { id: abId } });
      expect(afterReply.status).toBe("ACTIVE");

      const notifyForA = await prisma.userNotification.count({
        where: {
          eventId: ids.eventId!,
          userId: ids.userA!,
          conversationId: abId,
          kind: NotificationKind.MESSAGE,
        },
      });
      expect(notifyForA).toBe(1);

      const afterAccept = await sendAs(ids.userA!, abId, "Great, thanks");
      expect(afterAccept.status).toBe(200);

      // Organizer exemption: ADMIN-created DM is ACTIVE immediately.
      const adminCreate = await createDirect(ids.userAdmin!, ids.userB!, "ADMIN");
      expect(adminCreate.status).toBe(200);
      const adminDm = (await adminCreate.json()) as { id: string; status: string; initiatedById: string | null };
      expect(adminDm.status).toBe("ACTIVE");
      expect(adminDm.initiatedById).toBe(ids.userAdmin);

      const adminSend = await sendAs(ids.userAdmin!, adminDm.id, "Organizer hello", "ADMIN");
      expect(adminSend.status).toBe(200);
      const adminNotifyForB = await prisma.userNotification.count({
        where: {
          eventId: ids.eventId!,
          userId: ids.userB!,
          conversationId: adminDm.id,
          kind: NotificationKind.MESSAGE,
        },
      });
      expect(adminNotifyForB).toBe(1);
    },
    60_000,
  );
});

describe("conversation request gate (DB) — messaging_requests off", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  const ids: {
    orgId?: string;
    eventId?: string;
    userA?: string;
    userB?: string;
  } = {};

  beforeAll(async () => {
    const passwordHash = await hashPassword("TestPass12!x");
    const stamp = Date.now();

    const userA = await prisma.user.create({
      data: {
        email: `crq-off-a-${stamp}@example.com`,
        name: "RequestOff A",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const userB = await prisma.user.create({
      data: {
        email: `crq-off-b-${stamp}@example.com`,
        name: "RequestOff B",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    ids.userA = userA.id;
    ids.userB = userB.id;

    const org = await prisma.organization.create({
      data: {
        name: `RequestOff Org ${stamp}`,
        slug: `crq-off-org-${stamp}`,
        plan: "PRO",
        eventAllowance: 5,
        memberships: { create: { userId: userA.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;
    await applyPlanSkuToOrg(org.id, "pro_monthly");

    const event = await prisma.event.create({
      data: {
        name: `RequestOff Event ${stamp}`,
        slug: `crq-off-evt-${stamp}`,
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
          ],
        },
      },
    });
    ids.eventId = event.id;

    await upsertFeatureOverrides(event.id, {
      messaging_dms: true,
      messaging_requests: false,
    });

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
    const eventId = ids.eventId;
    if (eventId) {
      await prisma.userNotification.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.conversationMessage.deleteMany({ where: { conversation: { eventId } } }).catch(() => null);
      await prisma.conversationMember.deleteMany({ where: { conversation: { eventId } } }).catch(() => null);
      await prisma.conversation.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.eventFeatureConfig.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.eventMembership.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.event.delete({ where: { id: eventId } }).catch(() => null);
    }
    if (ids.orgId) {
      await prisma.orgMembership.deleteMany({ where: { organizationId: ids.orgId } }).catch(() => null);
      await prisma.organization.delete({ where: { id: ids.orgId } }).catch(() => null);
    }
    if (ids.userA) await prisma.user.delete({ where: { id: ids.userA } }).catch(() => null);
    if (ids.userB) await prisma.user.delete({ where: { id: ids.userB } }).catch(() => null);
    await prisma.$disconnect();
    if (server) {
      await new Promise<void>((resolveClose, reject) =>
        server.close((err) => (err ? reject(err) : resolveClose())),
      );
    }
  });

  function authHeaders(userId: string) {
    const token = signToken({ userId, role: "ATTENDEE" });
    return {
      authorization: `Bearer ${token}`,
      "x-event-id": ids.eventId!,
      "content-type": "application/json",
    };
  }

  it("flag off: new DM is ACTIVE and notifies normally", async () => {
    const createRes = await fetch(`${base}/conversations/direct`, {
      method: "POST",
      headers: authHeaders(ids.userA!),
      body: JSON.stringify({ userId: ids.userB! }),
    });
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as { id: string; status: string; initiatedById: string | null };
    expect(created.status).toBe("ACTIVE");
    expect(created.initiatedById).toBe(ids.userA);

    const sendRes = await fetch(`${base}/conversations/${created.id}/messages`, {
      method: "POST",
      headers: authHeaders(ids.userA!),
      body: JSON.stringify({ body: "Hello with gate off" }),
    });
    expect(sendRes.status).toBe(200);

    const notifyForB = await prisma.userNotification.count({
      where: {
        eventId: ids.eventId!,
        userId: ids.userB!,
        conversationId: created.id,
        kind: NotificationKind.MESSAGE,
      },
    });
    expect(notifyForB).toBe(1);
  }, 60_000);
});
