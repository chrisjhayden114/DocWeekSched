/**
 * Phase 6 Chunk B — account export (self-only).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "fs";
import { resolve } from "path";
import dotenv from "dotenv";

for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
  if (existsSync(p)) dotenv.config({ path: p });
}

import {
  EventMemberRole,
  OrgRole,
  PrismaClient,
  SessionAttendanceStatus,
  SessionJoinMode,
  SessionPublishStatus,
} from "@prisma/client";
import { hashPassword } from "../lib/auth";
import { buildAccountExport, exportAccountForUser } from "../lib/accountExport";
import { newJoinToken } from "../lib/inviteTokens";

describe("account export (DB)", () => {
  const prisma = new PrismaClient();
  const ids: {
    userA?: string;
    userB?: string;
    orgId?: string;
    eventId?: string;
    sessionId?: string;
  } = {};
  let dbReady = false;

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReady = true;
    } catch {
      console.warn("[accountExport.db.test] DATABASE_URL unreachable — skipping");
      return;
    }

    const passwordHash = await hashPassword("TestPass12!x");
    const stamp = Date.now();
    const userA = await prisma.user.create({
      data: {
        email: `export-a-${stamp}@example.com`,
        name: "Export Alice",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const userB = await prisma.user.create({
      data: {
        email: `export-b-${stamp}@secret-other.com`,
        name: "Export Bob SECRET",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    ids.userA = userA.id;
    ids.userB = userB.id;

    const org = await prisma.organization.create({
      data: {
        name: "Export Org",
        slug: `export-org-${stamp}`,
        memberships: {
          create: [
            { userId: userA.id, role: OrgRole.OWNER },
            { userId: userB.id, role: OrgRole.MEMBER },
          ],
        },
      },
    });
    ids.orgId = org.id;

    const { hash } = newJoinToken();
    const event = await prisma.event.create({
      data: {
        name: "Export Event",
        slug: `export-ev-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2026-09-01T10:00:00Z"),
        endDate: new Date("2026-09-02T18:00:00Z"),
        status: "ACTIVE",
        organizationId: org.id,
        createdById: userA.id,
        joinTokenHash: hash,
        memberships: {
          create: [
            { userId: userA.id, role: EventMemberRole.ATTENDEE },
            { userId: userB.id, role: EventMemberRole.ATTENDEE },
          ],
        },
      },
    });
    ids.eventId = event.id;

    const session = await prisma.session.create({
      data: {
        eventId: event.id,
        title: "Export Session",
        publishStatus: SessionPublishStatus.PUBLISHED,
        startsAt: new Date("2026-09-01T12:00:00Z"),
        endsAt: new Date("2026-09-01T13:00:00Z"),
      },
    });
    ids.sessionId = session.id;

    await prisma.sessionAttendance.create({
      data: {
        userId: userA.id,
        sessionId: session.id,
        status: SessionAttendanceStatus.JOINING,
        joinMode: SessionJoinMode.IN_PERSON,
      },
    });
    await prisma.sessionAttendance.create({
      data: {
        userId: userB.id,
        sessionId: session.id,
        status: SessionAttendanceStatus.JOINING,
        joinMode: SessionJoinMode.VIRTUAL,
      },
    });

    const conv = await prisma.conversation.create({
      data: {
        type: "DIRECT",
        eventId: event.id,
        members: {
          create: [{ userId: userA.id }, { userId: userB.id }],
        },
      },
    });
    await prisma.conversationMessage.create({
      data: {
        conversationId: conv.id,
        userId: userA.id,
        body: "Alice private hello",
      },
    });
    await prisma.conversationMessage.create({
      data: {
        conversationId: conv.id,
        userId: userB.id,
        body: "Bob SECRET message body must not appear in Alice export",
      },
    });
  }, 60_000);

  afterAll(async () => {
    if (dbReady) {
      const eventId = ids.eventId;
      if (eventId) {
        await prisma.conversationMessage.deleteMany({
          where: { conversation: { eventId } },
        });
        await prisma.conversationMember.deleteMany({
          where: { conversation: { eventId } },
        });
        await prisma.conversation.deleteMany({ where: { eventId } });
        await prisma.sessionAttendance.deleteMany({ where: { session: { eventId } } });
        await prisma.session.deleteMany({ where: { eventId } });
        await prisma.eventMembership.deleteMany({ where: { eventId } });
        await prisma.event.delete({ where: { id: eventId } }).catch(() => undefined);
      }
      if (ids.orgId) {
        await prisma.orgMembership.deleteMany({ where: { organizationId: ids.orgId } });
        await prisma.organization.delete({ where: { id: ids.orgId } }).catch(() => undefined);
      }
      for (const id of [ids.userA, ids.userB]) {
        if (id) await prisma.user.delete({ where: { id } }).catch(() => undefined);
      }
    }
    await prisma.$disconnect();
  });

  it("export contains expected keys for the subject only", async () => {
    if (!dbReady) return;
    const payload = await buildAccountExport(ids.userA!);
    expect(payload).toBeTruthy();
    expect(payload!.subjectUserId).toBe(ids.userA);
    expect(payload!.profile.email).toContain("export-a-");
    expect(payload!.orgMemberships.length).toBeGreaterThanOrEqual(1);
    expect(payload!.eventMemberships.some((m) => m.eventId === ids.eventId)).toBe(true);
    expect(payload!.attendance.some((a) => a.sessionId === ids.sessionId)).toBe(true);
    expect(payload!.messageMetadata.length).toBe(1);
    expect(payload!.messageMetadata[0]!.bodyLength).toBeGreaterThan(0);
    expect(Object.keys(payload!)).toEqual(
      expect.arrayContaining([
        "exportedAt",
        "subjectUserId",
        "profile",
        "orgMemberships",
        "eventMemberships",
        "attendance",
        "checkIns",
        "messageMetadata",
      ]),
    );
  });

  it("export contains NO other users' PII", async () => {
    if (!dbReady) return;
    const payload = await exportAccountForUser(ids.userA!);
    const json = JSON.stringify(payload);
    expect(json).not.toContain("secret-other.com");
    expect(json).not.toContain("Export Bob");
    expect(json).not.toContain("SECRET message");
    expect(json).not.toContain(ids.userB!);
    expect(json).not.toMatch(/password/i);
  });

  it("returns null for unknown user (auth boundary at route)", async () => {
    if (!dbReady) return;
    expect(await buildAccountExport("cuid_does_not_exist_zzzz")).toBeNull();
  });
});
