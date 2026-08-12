/**
 * M-SEEN — opt-in reciprocal read receipts on GET /conversations.
 * otherLastReadAt is set only for DIRECT threads when both the viewer and the
 * other member have readReceipts on; GROUP is always null.
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
import { ConversationType, EventMemberRole, EventStatus, OrgRole, PrismaClient } from "@prisma/client";
import { hashPassword, signToken } from "../lib/auth";
import { applyPlanSkuToOrg } from "../lib/billing/entitlements";
import { upsertFeatureOverrides } from "../lib/features/featureEnabled";
import { conversationsRouter } from "../routes/conversations";

type ConversationListItem = {
  id: string;
  type: string;
  otherLastReadAt?: string | null;
  members: { user: { id: string } }[];
};

describe("conversation seen receipts (DB)", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  const ids: {
    orgId?: string;
    eventId?: string;
    userA?: string;
    userB?: string;
    directId?: string;
    groupId?: string;
    bLastReadAtIso?: string;
  } = {};

  beforeAll(async () => {
    const passwordHash = await hashPassword("TestPass12!x");
    const stamp = Date.now();

    const userA = await prisma.user.create({
      data: {
        email: `cseen-a-${stamp}@example.com`,
        name: "Seen A",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const userB = await prisma.user.create({
      data: {
        email: `cseen-b-${stamp}@example.com`,
        name: "Seen B",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    ids.userA = userA.id;
    ids.userB = userB.id;

    const org = await prisma.organization.create({
      data: {
        name: `Seen Org ${stamp}`,
        slug: `cseen-org-${stamp}`,
        plan: "PRO",
        eventAllowance: 5,
        memberships: { create: { userId: userA.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;
    await applyPlanSkuToOrg(org.id, "pro_monthly");

    const event = await prisma.event.create({
      data: {
        name: `Seen Event ${stamp}`,
        slug: `cseen-evt-${stamp}`,
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
      messaging_groups: true,
    });

    const direct = await prisma.conversation.create({
      data: {
        eventId: event.id,
        type: ConversationType.DIRECT,
        members: {
          create: [{ userId: userA.id }, { userId: userB.id }],
        },
      },
    });
    ids.directId = direct.id;

    await prisma.conversationMessage.create({
      data: {
        conversationId: direct.id,
        userId: userA.id,
        body: "Hello from A",
      },
    });

    const bMember = await prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId: direct.id, userId: userB.id } },
      data: { lastReadAt: new Date() },
    });
    ids.bLastReadAtIso = bMember.lastReadAt!.toISOString();

    const group = await prisma.conversation.create({
      data: {
        eventId: event.id,
        type: ConversationType.GROUP,
        name: "Seen Test Group",
        members: {
          create: [{ userId: userA.id }, { userId: userB.id }],
        },
      },
    });
    ids.groupId = group.id;

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
      await prisma.notificationPreference.deleteMany({ where: { eventId } }).catch(() => null);
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
    if (ids.userA) {
      await prisma.notificationPreference.deleteMany({ where: { userId: ids.userA } }).catch(() => null);
      await prisma.user.delete({ where: { id: ids.userA } }).catch(() => null);
    }
    if (ids.userB) {
      await prisma.notificationPreference.deleteMany({ where: { userId: ids.userB } }).catch(() => null);
      await prisma.user.delete({ where: { id: ids.userB } }).catch(() => null);
    }
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

  async function listAs(userId: string): Promise<ConversationListItem[]> {
    const res = await fetch(`${base}/conversations`, { headers: authHeaders(userId) });
    expect(res.status).toBe(200);
    return (await res.json()) as ConversationListItem[];
  }

  async function setReadReceipts(userId: string, on: boolean) {
    const existing = await prisma.notificationPreference.findFirst({
      where: { userId, eventId: ids.eventId },
    });
    if (existing) {
      await prisma.notificationPreference.update({
        where: { id: existing.id },
        data: { readReceipts: on },
      });
    } else {
      await prisma.notificationPreference.create({
        data: { userId, eventId: ids.eventId, readReceipts: on },
      });
    }
  }

  it("both prefs on: A's GET shows otherLastReadAt set on the DIRECT conversation", async () => {
    await setReadReceipts(ids.userA!, true);
    await setReadReceipts(ids.userB!, true);
    const asA = await listAs(ids.userA!);
    const direct = asA.find((c) => c.id === ids.directId);
    expect(direct).toBeTruthy();
    expect(direct!.otherLastReadAt).toBe(ids.bLastReadAtIso);
    expect(direct!.members.every((m) => Object.keys(m).length === 1 && m.user?.id)).toBe(true);
  }, 60_000);

  it("A on, B off: A's GET shows otherLastReadAt null (B's read state is private)", async () => {
    await setReadReceipts(ids.userA!, true);
    await setReadReceipts(ids.userB!, false);
    const asA = await listAs(ids.userA!);
    const direct = asA.find((c) => c.id === ids.directId);
    expect(direct).toBeTruthy();
    expect(direct!.otherLastReadAt).toBeNull();
  }, 60_000);

  it("A off, B on: A's GET shows otherLastReadAt null (reciprocity)", async () => {
    await setReadReceipts(ids.userA!, false);
    await setReadReceipts(ids.userB!, true);
    const asA = await listAs(ids.userA!);
    const direct = asA.find((c) => c.id === ids.directId);
    expect(direct).toBeTruthy();
    expect(direct!.otherLastReadAt).toBeNull();
  }, 60_000);

  it("GROUP conversation: otherLastReadAt is always null", async () => {
    await setReadReceipts(ids.userA!, true);
    await setReadReceipts(ids.userB!, true);
    const asA = await listAs(ids.userA!);
    const group = asA.find((c) => c.id === ids.groupId);
    expect(group).toBeTruthy();
    expect(group!.type).toBe("GROUP");
    expect(group!.otherLastReadAt).toBeNull();
  }, 60_000);
});
