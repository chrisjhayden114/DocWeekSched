/**
 * M5 — report transcript snapshot + organizer messaging suspend:
 * reports filed with conversationId freeze the transcript; later messages
 * do not mutate it; suspended members cannot send or start DMs.
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
import { moderationRouter } from "../routes/moderation";

type SnapshotLine = {
  senderId: string | null;
  senderName: string;
  body: string;
  createdAt: string;
};

type ReportRow = {
  id: string;
  conversationId: string | null;
  transcriptSnapshot: SnapshotLine[] | null;
  reportedUserSuspended?: boolean;
};

const SUSPEND_COPY = "Messaging isn't available for your account at this event.";

describe("moderation transcript snapshot + messaging suspend (DB)", () => {
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
    directId?: string;
  } = {};

  beforeAll(async () => {
    const passwordHash = await hashPassword("TestPass12!x");
    const stamp = Date.now();

    const userA = await prisma.user.create({
      data: {
        email: `m5-a-${stamp}@example.com`,
        name: "Transcript A",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const userB = await prisma.user.create({
      data: {
        email: `m5-b-${stamp}@example.com`,
        name: "Transcript B",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const userC = await prisma.user.create({
      data: {
        email: `m5-c-${stamp}@example.com`,
        name: "Transcript C",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const userAdmin = await prisma.user.create({
      data: {
        email: `m5-admin-${stamp}@example.com`,
        name: "Transcript Admin",
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
        name: `Transcript Org ${stamp}`,
        slug: `m5-org-${stamp}`,
        plan: "PRO",
        eventAllowance: 5,
        memberships: { create: { userId: userAdmin.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;
    await applyPlanSkuToOrg(org.id, "pro_monthly");

    const event = await prisma.event.create({
      data: {
        name: `Transcript Event ${stamp}`,
        slug: `m5-evt-${stamp}`,
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
        body: "first from A",
        createdAt: new Date("2027-09-01T15:00:00Z"),
      },
    });
    await prisma.conversationMessage.create({
      data: {
        conversationId: direct.id,
        userId: userB.id,
        body: "second from B",
        createdAt: new Date("2027-09-01T15:01:00Z"),
      },
    });

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
    const eventId = ids.eventId;
    if (eventId) {
      await prisma.userNotification.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.userReport.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.userBlock.deleteMany({ where: { eventId } }).catch(() => null);
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
    if (ids.userC) await prisma.user.delete({ where: { id: ids.userC } }).catch(() => null);
    if (ids.userAdmin) await prisma.user.delete({ where: { id: ids.userAdmin } }).catch(() => null);
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

  async function sendAs(userId: string, conversationId: string, body: string) {
    return fetch(`${base}/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: authHeaders(userId),
      body: JSON.stringify({ body }),
    });
  }

  it("report with conversationId snapshots the transcript and stays immutable after later messages", async () => {
    const reportRes = await fetch(`${base}/moderation/report`, {
      method: "POST",
      headers: authHeaders(ids.userA!),
      body: JSON.stringify({
        userId: ids.userB,
        reason: "Harassment",
        conversationId: ids.directId,
      }),
    });
    expect(reportRes.status).toBe(201);
    const created = (await reportRes.json()) as ReportRow;
    expect(created.conversationId).toBe(ids.directId);
    expect(Array.isArray(created.transcriptSnapshot)).toBe(true);
    expect(created.transcriptSnapshot).toHaveLength(2);
    expect(created.transcriptSnapshot!.map((m) => m.body)).toEqual(["first from A", "second from B"]);
    expect(created.transcriptSnapshot![0]!.senderId).toBe(ids.userA);
    expect(created.transcriptSnapshot![1]!.senderId).toBe(ids.userB);

    const third = await sendAs(ids.userB!, ids.directId!, "third from B");
    expect(third.status).toBe(200);

    const listRes = await fetch(`${base}/moderation/reports`, {
      headers: authHeaders(ids.userAdmin!, "ADMIN"),
    });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as ReportRow[];
    const row = list.find((r) => r.id === created.id);
    expect(row).toBeTruthy();
    expect(row!.transcriptSnapshot).toHaveLength(2);
    expect(row!.transcriptSnapshot!.map((m) => m.body)).toEqual(["first from A", "second from B"]);
    expect(row!.reportedUserSuspended).toBe(false);
  }, 60_000);

  it("reporter who is not a conversation member cannot attach that conversationId", async () => {
    const res = await fetch(`${base}/moderation/report`, {
      method: "POST",
      headers: authHeaders(ids.userC!),
      body: JSON.stringify({
        userId: ids.userB,
        reason: "Spam",
        conversationId: ids.directId,
      }),
    });
    expect(res.status).toBe(403);
  }, 60_000);

  it("manager suspend blocks send and new DMs; unsuspend restores both", async () => {
    const suspendRes = await fetch(`${base}/moderation/suspend-messaging`, {
      method: "POST",
      headers: authHeaders(ids.userAdmin!, "ADMIN"),
      body: JSON.stringify({ userId: ids.userB, suspended: true }),
    });
    expect(suspendRes.status).toBe(200);
    expect(await suspendRes.json()).toEqual({ userId: ids.userB, suspended: true });

    const blockedSend = await sendAs(ids.userB!, ids.directId!, "should not send");
    expect(blockedSend.status).toBe(403);
    expect(await blockedSend.json()).toEqual({ error: SUSPEND_COPY });

    const blockedDirect = await fetch(`${base}/conversations/direct`, {
      method: "POST",
      headers: authHeaders(ids.userB!),
      body: JSON.stringify({ userId: ids.userC }),
    });
    expect(blockedDirect.status).toBe(403);
    expect(await blockedDirect.json()).toEqual({ error: SUSPEND_COPY });

    const unsuspendRes = await fetch(`${base}/moderation/suspend-messaging`, {
      method: "POST",
      headers: authHeaders(ids.userAdmin!, "ADMIN"),
      body: JSON.stringify({ userId: ids.userB, suspended: false }),
    });
    expect(unsuspendRes.status).toBe(200);
    expect(await unsuspendRes.json()).toEqual({ userId: ids.userB, suspended: false });

    const afterSend = await sendAs(ids.userB!, ids.directId!, "hello after unsuspend");
    expect(afterSend.status).toBe(200);

    const afterDirect = await fetch(`${base}/conversations/direct`, {
      method: "POST",
      headers: authHeaders(ids.userB!),
      body: JSON.stringify({ userId: ids.userC }),
    });
    expect(afterDirect.status).toBe(200);
  }, 60_000);

  it("plain attendee cannot call /suspend-messaging", async () => {
    const res = await fetch(`${base}/moderation/suspend-messaging`, {
      method: "POST",
      headers: authHeaders(ids.userA!),
      body: JSON.stringify({ userId: ids.userB, suspended: true }),
    });
    expect(res.status).toBe(403);
  }, 60_000);
});
