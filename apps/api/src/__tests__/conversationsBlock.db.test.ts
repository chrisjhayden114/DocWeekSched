/**
 * M3 — block hardening on the send path: a UserBlock between DIRECT members
 * rejects POST /:id/messages with a neutral 403, GET /conversations exposes
 * `blocked` for the viewer, unblocking restores sending, GROUP is unaffected.
 * BLOCK-W — blocks are account-wide; a block under event 1 enforces in event 2.
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
  OrgRole,
  PrismaClient,
} from "@prisma/client";
import { hashPassword, signToken } from "../lib/auth";
import { applyPlanSkuToOrg } from "../lib/billing/entitlements";
import { upsertFeatureOverrides } from "../lib/features/featureEnabled";
import { conversationsRouter } from "../routes/conversations";
import { moderationRouter } from "../routes/moderation";

type ConversationListItem = {
  id: string;
  type: string;
  blocked?: boolean;
};

describe("conversation block enforcement (DB)", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  const ids: {
    orgId?: string;
    eventId?: string;
    event2Id?: string;
    userA?: string;
    userB?: string;
    directId?: string;
    direct2Id?: string;
    groupId?: string;
  } = {};

  beforeAll(async () => {
    const passwordHash = await hashPassword("TestPass12!x");
    const stamp = Date.now();

    const userA = await prisma.user.create({
      data: {
        email: `cblk-a-${stamp}@example.com`,
        name: "Block A",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const userB = await prisma.user.create({
      data: {
        email: `cblk-b-${stamp}@example.com`,
        name: "Block B",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    ids.userA = userA.id;
    ids.userB = userB.id;

    const org = await prisma.organization.create({
      data: {
        name: `Block Org ${stamp}`,
        slug: `cblk-org-${stamp}`,
        plan: "PRO",
        eventAllowance: 5,
        memberships: { create: { userId: userA.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;
    await applyPlanSkuToOrg(org.id, "pro_monthly");

    const event = await prisma.event.create({
      data: {
        name: `Block Event ${stamp}`,
        slug: `cblk-evt-${stamp}`,
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

    const group = await prisma.conversation.create({
      data: {
        eventId: event.id,
        type: ConversationType.GROUP,
        name: "Block Test Group",
        members: {
          create: [{ userId: userA.id }, { userId: userB.id }],
        },
      },
    });
    ids.groupId = group.id;

    // Second event for BLOCK-W cross-event enforcement.
    const event2 = await prisma.event.create({
      data: {
        name: `Block Event 2 ${stamp}`,
        slug: `cblk-evt2-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2027-10-01T14:00:00Z"),
        endDate: new Date("2027-10-03T22:00:00Z"),
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
    ids.event2Id = event2.id;

    await upsertFeatureOverrides(event2.id, {
      messaging_dms: true,
      messaging_groups: true,
    });

    const direct2 = await prisma.conversation.create({
      data: {
        eventId: event2.id,
        type: ConversationType.DIRECT,
        members: {
          create: [{ userId: userA.id }, { userId: userB.id }],
        },
      },
    });
    ids.direct2Id = direct2.id;

    const app = express();
    app.use(express.json());
    app.use("/conversations", conversationsRouter);
    app.use("/moderation", moderationRouter);
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
    const eventIds = [ids.eventId, ids.event2Id].filter((id): id is string => Boolean(id));
    if (ids.userA && ids.userB) {
      await prisma.userBlock
        .deleteMany({
          where: {
            OR: [
              { blockerId: ids.userA, blockedId: ids.userB },
              { blockerId: ids.userB, blockedId: ids.userA },
            ],
          },
        })
        .catch(() => null);
    }
    for (const eventId of eventIds) {
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

  function authHeaders(userId: string, eventId = ids.eventId!) {
    const token = signToken({ userId, role: "ATTENDEE" });
    return {
      authorization: `Bearer ${token}`,
      "x-event-id": eventId,
      "content-type": "application/json",
    };
  }

  async function sendAs(userId: string, conversationId: string, body: string, eventId = ids.eventId!) {
    return fetch(`${base}/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: authHeaders(userId, eventId),
      body: JSON.stringify({ body }),
    });
  }

  async function listAs(userId: string): Promise<ConversationListItem[]> {
    const res = await fetch(`${base}/conversations`, { headers: authHeaders(userId) });
    expect(res.status).toBe(200);
    return (await res.json()) as ConversationListItem[];
  }

  it("block stops DIRECT sends with a neutral 403; unblock restores; GROUP unaffected", async () => {
    // Sanity: sending works before any block exists.
    const before = await sendAs(ids.userB!, ids.directId!, "hello before block");
    expect(before.status).toBe(200);

    // A blocks B.
    const blockRes = await fetch(`${base}/moderation/block`, {
      method: "POST",
      headers: authHeaders(ids.userA!),
      body: JSON.stringify({ userId: ids.userB! }),
    });
    expect(blockRes.status).toBe(201);

    // B's send into the existing DIRECT conversation is rejected neutrally.
    const blockedSend = await sendAs(ids.userB!, ids.directId!, "hello while blocked");
    expect(blockedSend.status).toBe(403);
    expect(await blockedSend.json()).toEqual({ error: "You can't send messages to this person." });

    // A's list surfaces blocked: true on the DIRECT row only.
    const asA = await listAs(ids.userA!);
    const directRow = asA.find((c) => c.id === ids.directId);
    expect(directRow).toBeTruthy();
    expect(directRow!.blocked).toBe(true);
    const groupRow = asA.find((c) => c.id === ids.groupId);
    expect(groupRow).toBeTruthy();
    expect(groupRow!.blocked).toBe(false);

    // GROUP sends are unaffected by the block.
    const groupSend = await sendAs(ids.userB!, ids.groupId!, "group message while blocked");
    expect(groupSend.status).toBe(200);

    // A unblocks B.
    const unblockRes = await fetch(`${base}/moderation/block/${ids.userB}`, {
      method: "DELETE",
      headers: authHeaders(ids.userA!),
    });
    expect(unblockRes.status).toBe(200);
    expect(await unblockRes.json()).toEqual({ ok: true });

    // B can send again.
    const afterUnblock = await sendAs(ids.userB!, ids.directId!, "hello after unblock");
    expect(afterUnblock.status).toBe(200);

    const asAAfter = await listAs(ids.userA!);
    expect(asAAfter.find((c) => c.id === ids.directId)!.blocked).toBe(false);
  }, 60_000);

  it("BLOCK-W: block under event 1 enforces in event 2; unblock clears everywhere", async () => {
    const event2 = ids.event2Id!;

    // A blocks B under event 1 (eventId is provenance only).
    const blockRes = await fetch(`${base}/moderation/block`, {
      method: "POST",
      headers: authHeaders(ids.userA!, ids.eventId!),
      body: JSON.stringify({ userId: ids.userB! }),
    });
    expect(blockRes.status).toBe(201);

    // (a) POST /conversations/direct in event 2 is refused.
    const directCreate = await fetch(`${base}/conversations/direct`, {
      method: "POST",
      headers: authHeaders(ids.userA!, event2),
      body: JSON.stringify({ userId: ids.userB! }),
    });
    expect(directCreate.status).toBe(403);

    // (b) Existing event-2 thread POST message returns the neutral 403.
    const blockedSend = await sendAs(ids.userB!, ids.direct2Id!, "cross-event while blocked", event2);
    expect(blockedSend.status).toBe(403);
    expect(await blockedSend.json()).toEqual({ error: "You can't send messages to this person." });

    // Unblock via moderation (any event context); removes the pair everywhere.
    const unblockRes = await fetch(`${base}/moderation/block/${ids.userB}`, {
      method: "DELETE",
      headers: authHeaders(ids.userA!, event2),
    });
    expect(unblockRes.status).toBe(200);

    // Event-2 messaging works again.
    const afterUnblock = await sendAs(ids.userB!, ids.direct2Id!, "cross-event after unblock", event2);
    expect(afterUnblock.status).toBe(200);
  }, 60_000);
});
