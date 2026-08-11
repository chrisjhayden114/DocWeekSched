/**
 * M2 — ConversationMember lastReadAt + mutedAt: unread compute, mark read,
 * mute silences notifyNewMessage, tenancy (own member row only).
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
import {
  ConversationType,
  EventMemberRole,
  EventStatus,
  NotificationKind,
  OrgRole,
  PrismaClient,
} from "@prisma/client";
import { hashPassword, signToken } from "../lib/auth";
import { applyPlanSkuToOrg } from "../lib/billing/entitlements";
import { upsertFeatureOverrides } from "../lib/features/featureEnabled";
import { notifyNewMessage } from "../lib/notifications";
import { conversationsRouter } from "../routes/conversations";

type ConversationListItem = {
  id: string;
  unread?: boolean;
  muted?: boolean;
  members: { user: { id: string } }[];
};

describe("conversation read state + mute (DB)", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  const ids: {
    orgId?: string;
    eventId?: string;
    userA?: string;
    userB?: string;
    conversationId?: string;
  } = {};

  beforeAll(async () => {
    const passwordHash = await hashPassword("TestPass12!x");
    const stamp = Date.now();

    const userA = await prisma.user.create({
      data: {
        email: `crm-a-${stamp}@example.com`,
        name: "ReadMute A",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const userB = await prisma.user.create({
      data: {
        email: `crm-b-${stamp}@example.com`,
        name: "ReadMute B",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    ids.userA = userA.id;
    ids.userB = userB.id;

    const org = await prisma.organization.create({
      data: {
        name: `ReadMute Org ${stamp}`,
        slug: `crm-org-${stamp}`,
        plan: "PRO",
        eventAllowance: 5,
        memberships: { create: { userId: userA.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;
    await applyPlanSkuToOrg(org.id, "pro_monthly");

    const event = await prisma.event.create({
      data: {
        name: `ReadMute Event ${stamp}`,
        slug: `crm-evt-${stamp}`,
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

    const conversation = await prisma.conversation.create({
      data: {
        eventId: event.id,
        type: ConversationType.DIRECT,
        members: {
          create: [{ userId: userA.id }, { userId: userB.id }],
        },
      },
    });
    ids.conversationId = conversation.id;

    await prisma.conversationMessage.create({
      data: {
        conversationId: conversation.id,
        userId: userB.id,
        body: "Hello from B",
      },
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

  function authHeaders(userId: string, role: "ATTENDEE" | "ADMIN" = "ATTENDEE") {
    const token = signToken({ userId, role });
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

  it("GET computes unread for viewer after peer message; read/mute are per-member", async () => {
    const asA = await listAs(ids.userA!);
    const rowA = asA.find((c) => c.id === ids.conversationId);
    expect(rowA).toBeTruthy();
    expect(rowA!.unread).toBe(true);
    expect(rowA!.muted).toBe(false);
    // Members reduced to { user } — no lastReadAt/mutedAt leak.
    expect(rowA!.members.every((m) => Object.keys(m).length === 1 && m.user?.id)).toBe(true);

    const asB = await listAs(ids.userB!);
    const rowB = asB.find((c) => c.id === ids.conversationId);
    expect(rowB).toBeTruthy();
    // B sent the last message → not unread for B.
    expect(rowB!.unread).toBe(false);

    const readRes = await fetch(`${base}/conversations/${ids.conversationId}/read`, {
      method: "POST",
      headers: authHeaders(ids.userA!),
    });
    expect(readRes.status).toBe(200);
    expect(await readRes.json()).toEqual({ ok: true });

    const afterRead = (await listAs(ids.userA!)).find((c) => c.id === ids.conversationId);
    expect(afterRead!.unread).toBe(false);

    const memberA = await prisma.conversationMember.findUniqueOrThrow({
      where: {
        conversationId_userId: { conversationId: ids.conversationId!, userId: ids.userA! },
      },
    });
    const memberB = await prisma.conversationMember.findUniqueOrThrow({
      where: {
        conversationId_userId: { conversationId: ids.conversationId!, userId: ids.userB! },
      },
    });
    expect(memberA.lastReadAt).not.toBeNull();
    expect(memberB.lastReadAt).toBeNull();

    const muteRes = await fetch(`${base}/conversations/${ids.conversationId}/mute`, {
      method: "POST",
      headers: authHeaders(ids.userA!),
      body: JSON.stringify({ muted: true }),
    });
    expect(muteRes.status).toBe(200);
    expect(await muteRes.json()).toEqual({ muted: true });

    const afterMute = (await listAs(ids.userA!)).find((c) => c.id === ids.conversationId);
    expect(afterMute!.muted).toBe(true);
    expect(afterMute!.unread).toBe(false);

    const memberAMuted = await prisma.conversationMember.findUniqueOrThrow({
      where: {
        conversationId_userId: { conversationId: ids.conversationId!, userId: ids.userA! },
      },
    });
    const memberBAfterMute = await prisma.conversationMember.findUniqueOrThrow({
      where: {
        conversationId_userId: { conversationId: ids.conversationId!, userId: ids.userB! },
      },
    });
    expect(memberAMuted.mutedAt).not.toBeNull();
    expect(memberBAfterMute.mutedAt).toBeNull();

    // New message from B while A is muted → no MESSAGE notification for A.
    await prisma.conversationMessage.create({
      data: {
        conversationId: ids.conversationId!,
        userId: ids.userB!,
        body: "Muted ping",
      },
    });
    await notifyNewMessage({
      eventId: ids.eventId!,
      conversationId: ids.conversationId!,
      senderId: ids.userB!,
      senderName: "ReadMute B",
      preview: "Muted ping",
      memberUserIds: [ids.userA!, ids.userB!],
    });

    const notifsForA = await prisma.userNotification.findMany({
      where: {
        userId: ids.userA!,
        eventId: ids.eventId!,
        kind: NotificationKind.MESSAGE,
        conversationId: ids.conversationId!,
      },
    });
    expect(notifsForA).toHaveLength(0);

    const stillUnreadMuted = (await listAs(ids.userA!)).find((c) => c.id === ids.conversationId);
    expect(stillUnreadMuted!.unread).toBe(false);
    expect(stillUnreadMuted!.muted).toBe(true);
  }, 60_000);

  it("POST /conversations/read-all marks all of viewer's member rows for the event", async () => {
    // Unmute + clear lastReadAt so unread can return, then mark-all.
    await prisma.conversationMember.update({
      where: {
        conversationId_userId: { conversationId: ids.conversationId!, userId: ids.userA! },
      },
      data: { mutedAt: null, lastReadAt: null },
    });

    const before = (await listAs(ids.userA!)).find((c) => c.id === ids.conversationId);
    expect(before!.unread).toBe(true);

    const res = await fetch(`${base}/conversations/read-all`, {
      method: "POST",
      headers: authHeaders(ids.userA!),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const after = (await listAs(ids.userA!)).find((c) => c.id === ids.conversationId);
    expect(after!.unread).toBe(false);

    const memberB = await prisma.conversationMember.findUniqueOrThrow({
      where: {
        conversationId_userId: { conversationId: ids.conversationId!, userId: ids.userB! },
      },
    });
    // B's row untouched by A's read-all.
    expect(memberB.lastReadAt).toBeNull();
  }, 60_000);
});
