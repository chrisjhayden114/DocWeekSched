/**
 * M6 — who-can-message policy on POST /direct, and unread-DM email sweep
 * (max one per day, skips muted / REQUESTED / opted-out).
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
  NotificationClass,
  NotificationDelivery,
  NotificationKind,
  OrgRole,
  PrismaClient,
} from "@prisma/client";
import { hashPassword, signToken } from "../lib/auth";
import { applyPlanSkuToOrg } from "../lib/billing/entitlements";
import { upsertFeatureOverrides } from "../lib/features/featureEnabled";
import { conversationsRouter } from "../routes/conversations";
import { sweepUnreadMessageEmails } from "../lib/notifications/messageEmailSweep";
import { localDayKey } from "../lib/notifications/timezone";
import { messageEmailDedupKey } from "../lib/notifications/messageEmailRules";

describe("message policy (DB)", () => {
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
    abConvId?: string;
  } = {};

  beforeAll(async () => {
    const passwordHash = await hashPassword("TestPass12!x");
    const stamp = Date.now();

    const userA = await prisma.user.create({
      data: {
        email: `m6p-a-${stamp}@example.com`,
        name: "Policy A",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const userB = await prisma.user.create({
      data: {
        email: `m6p-b-${stamp}@example.com`,
        name: "Policy B",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const userC = await prisma.user.create({
      data: {
        email: `m6p-c-${stamp}@example.com`,
        name: "Policy C",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const userAdmin = await prisma.user.create({
      data: {
        email: `m6p-admin-${stamp}@example.com`,
        name: "Policy Admin",
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
        name: `Policy Org ${stamp}`,
        slug: `m6p-org-${stamp}`,
        plan: "PRO",
        eventAllowance: 5,
        memberships: { create: { userId: userAdmin.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;
    await applyPlanSkuToOrg(org.id, "pro_monthly");

    const event = await prisma.event.create({
      data: {
        name: `Policy Event ${stamp}`,
        slug: `m6p-evt-${stamp}`,
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
      messaging_requests: false,
    });

    const ab = await prisma.conversation.create({
      data: {
        eventId: event.id,
        type: ConversationType.DIRECT,
        status: "ACTIVE",
        initiatedById: userA.id,
        members: { create: [{ userId: userA.id }, { userId: userB.id }] },
      },
    });
    ids.abConvId = ab.id;

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
  }, 60_000);

  function authHeaders(userId: string, role: "ATTENDEE" | "ADMIN" = "ATTENDEE") {
    const token = signToken({ userId, role });
    return {
      authorization: `Bearer ${token}`,
      "x-event-id": ids.eventId!,
      "content-type": "application/json",
    };
  }

  async function createDirect(fromUserId: string, toUserId: string, role: "ATTENDEE" | "ADMIN" = "ATTENDEE") {
    return fetch(`${base}/conversations/direct`, {
      method: "POST",
      headers: authHeaders(fromUserId, role),
      body: JSON.stringify({ userId: toUserId }),
    });
  }

  it("EXISTING_ONLY blocks strangers, returns existing thread, organizers exempt", async () => {
    await prisma.eventMembership.updateMany({
      where: { eventId: ids.eventId!, userId: ids.userB! },
      data: { messagePolicy: "EXISTING_ONLY" },
    });

    const stranger = await createDirect(ids.userC!, ids.userB!);
    expect(stranger.status).toBe(403);
    expect(await stranger.json()).toEqual({ error: "This person isn't accepting new messages." });

    const existing = await createDirect(ids.userA!, ids.userB!);
    expect(existing.status).toBe(200);
    const existingBody = (await existing.json()) as { id: string };
    expect(existingBody.id).toBe(ids.abConvId);

    const organizer = await createDirect(ids.userAdmin!, ids.userB!, "ADMIN");
    expect(organizer.status).toBe(200);
    const orgBody = (await organizer.json()) as { id: string };
    expect(orgBody.id).toBeTruthy();
    expect(orgBody.id).not.toBe(ids.abConvId);
  }, 60_000);

  it("NONE blocks strangers; ANYONE allows", async () => {
    await prisma.eventMembership.updateMany({
      where: { eventId: ids.eventId!, userId: ids.userB! },
      data: { messagePolicy: "NONE" },
    });
    const noneRes = await createDirect(ids.userC!, ids.userB!);
    expect(noneRes.status).toBe(403);
    expect(await noneRes.json()).toEqual({ error: "This person isn't accepting new messages." });

    await prisma.eventMembership.updateMany({
      where: { eventId: ids.eventId!, userId: ids.userB! },
      data: { messagePolicy: "ANYONE" },
    });
    const anyoneRes = await createDirect(ids.userC!, ids.userB!);
    expect(anyoneRes.status).toBe(200);
    const anyoneBody = (await anyoneRes.json()) as { id: string };
    expect(anyoneBody.id).toBeTruthy();
  }, 60_000);
});

describe("unread message email sweep (DB)", () => {
  const prisma = new PrismaClient();
  const ids: {
    orgId?: string;
    eventId?: string;
    userA?: string;
    userB?: string;
    userOff?: string;
    userMuted?: string;
    convA?: string;
    convOff?: string;
    convMuted?: string;
  } = {};
  const now = new Date("2027-06-15T16:00:00Z");
  const aged = new Date(now.getTime() - 20 * 60 * 1000);

  beforeAll(async () => {
    const passwordHash = await hashPassword("TestPass12!x");
    const stamp = Date.now();

    const userA = await prisma.user.create({
      data: {
        email: `m6e-a-${stamp}@example.com`,
        name: "Email A",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const userB = await prisma.user.create({
      data: {
        email: `m6e-b-${stamp}@example.com`,
        name: "Email B",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const userOff = await prisma.user.create({
      data: {
        email: `m6e-off-${stamp}@example.com`,
        name: "Email Off",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const userMuted = await prisma.user.create({
      data: {
        email: `m6e-muted-${stamp}@example.com`,
        name: "Email Muted",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    ids.userA = userA.id;
    ids.userB = userB.id;
    ids.userOff = userOff.id;
    ids.userMuted = userMuted.id;

    const org = await prisma.organization.create({
      data: {
        name: `Email Org ${stamp}`,
        slug: `m6e-org-${stamp}`,
        plan: "PRO",
        eventAllowance: 5,
        memberships: { create: { userId: userA.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;
    await applyPlanSkuToOrg(org.id, "pro_monthly");

    const event = await prisma.event.create({
      data: {
        name: `Email Event ${stamp}`,
        slug: `m6e-evt-${stamp}`,
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
            { userId: userOff.id, role: EventMemberRole.ATTENDEE, directoryOptIn: true },
            { userId: userMuted.id, role: EventMemberRole.ATTENDEE, directoryOptIn: true },
          ],
        },
      },
    });
    ids.eventId = event.id;

    const convA = await prisma.conversation.create({
      data: {
        eventId: event.id,
        type: ConversationType.DIRECT,
        status: "ACTIVE",
        members: { create: [{ userId: userA.id }, { userId: userB.id }] },
      },
    });
    ids.convA = convA.id;

    const convOff = await prisma.conversation.create({
      data: {
        eventId: event.id,
        type: ConversationType.DIRECT,
        status: "ACTIVE",
        members: { create: [{ userId: userOff.id }, { userId: userB.id }] },
      },
    });
    ids.convOff = convOff.id;

    const convMuted = await prisma.conversation.create({
      data: {
        eventId: event.id,
        type: ConversationType.DIRECT,
        status: "ACTIVE",
        members: { create: [{ userId: userMuted.id }, { userId: userB.id }] },
      },
    });
    ids.convMuted = convMuted.id;

    await prisma.conversationMember.updateMany({
      where: { conversationId: convMuted.id, userId: userMuted.id },
      data: { mutedAt: now },
    });

    await prisma.notificationPreference.create({
      data: {
        userId: userOff.id,
        eventId: event.id,
        messageEmail: false,
        timezone: "UTC",
        quietHoursStart: "22:00",
        quietHoursEnd: "07:00",
      },
    });
  }, 60_000);

  afterAll(async () => {
    const eventId = ids.eventId;
    if (eventId) {
      await prisma.userNotification.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.notificationPreference.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.conversationMessage.deleteMany({ where: { conversation: { eventId } } }).catch(() => null);
      await prisma.conversationMember.deleteMany({ where: { conversation: { eventId } } }).catch(() => null);
      await prisma.conversation.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.eventMembership.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.event.delete({ where: { id: eventId } }).catch(() => null);
    }
    if (ids.orgId) {
      await prisma.orgMembership.deleteMany({ where: { organizationId: ids.orgId } }).catch(() => null);
      await prisma.organization.delete({ where: { id: ids.orgId } }).catch(() => null);
    }
    for (const id of [ids.userA, ids.userB, ids.userOff, ids.userMuted]) {
      if (id) await prisma.user.delete({ where: { id } }).catch(() => null);
    }
    await prisma.$disconnect();
  }, 60_000);

  async function seedUnread(userId: string, conversationId: string) {
    return prisma.userNotification.create({
      data: {
        userId,
        eventId: ids.eventId!,
        kind: NotificationKind.MESSAGE,
        class: NotificationClass.DIGEST,
        delivery: NotificationDelivery.INBOX,
        title: "Message from Email B",
        body: "Hello, this is an unread DM preview",
        conversationId,
        createdAt: aged,
      },
    });
  }

  it("sends once for an aged unread ACTIVE DM and dedups the same day", async () => {
    await seedUnread(ids.userA!, ids.convA!);
    const first = await sweepUnreadMessageEmails(now);
    expect(first.sent).toBeGreaterThanOrEqual(1);

    const dayKey = localDayKey(now, "UTC");
    const dedup = messageEmailDedupKey(ids.userA!, ids.eventId!, dayKey);
    const row = await prisma.userNotification.findFirst({
      where: { pushDedupKey: dedup },
    });
    expect(row).toBeTruthy();
    expect(row!.kind).toBe(NotificationKind.DIGEST_ROLLUP);

    const second = await sweepUnreadMessageEmails(now);
    expect(second.sent).toBe(0);
  }, 60_000);

  it("messageEmail=false sends 0", async () => {
    await seedUnread(ids.userOff!, ids.convOff!);
    const result = await sweepUnreadMessageEmails(now);
    expect(result.sent).toBe(0);
    const rollup = await prisma.userNotification.findFirst({
      where: { userId: ids.userOff!, eventId: ids.eventId!, kind: NotificationKind.DIGEST_ROLLUP },
    });
    expect(rollup).toBeNull();
  }, 60_000);

  it("muted conversation is excluded", async () => {
    await seedUnread(ids.userMuted!, ids.convMuted!);
    const result = await sweepUnreadMessageEmails(now);
    expect(result.sent).toBe(0);
    const rollup = await prisma.userNotification.findFirst({
      where: { userId: ids.userMuted!, eventId: ids.eventId!, kind: NotificationKind.DIGEST_ROLLUP },
    });
    expect(rollup).toBeNull();
  }, 60_000);
});
