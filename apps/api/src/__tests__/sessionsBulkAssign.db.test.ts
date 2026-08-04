import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "fs";
import { resolve } from "path";
import dotenv from "dotenv";

// Load monorepo /.env when running vitest from apps/api (matches API boot).
for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
  if (existsSync(p)) dotenv.config({ path: p });
}

import {
  EventMemberRole,
  EventStatus,
  OrgRole,
  PrismaClient,
  SessionPublishStatus,
} from "@prisma/client";
import { hashPassword } from "../lib/auth";
import { HttpError, requireEventAccess } from "../lib/authorization";
import { bulkAssignSessions } from "../lib/sessions/bulkAssign";

/**
 * E16.2 — POST /sessions/bulk-assign.
 * Authorization: the route requires requireEventAccess(manage: true); an
 * attendee must be rejected. Tenancy: sessions, tracks and rooms from another
 * event must be rejected even when the ids are real.
 */
describe("sessions bulk-assign (DB)", () => {
  const prisma = new PrismaClient();
  const ids: {
    orgId?: string;
    eventId?: string;
    otherEventId?: string;
    adminId?: string;
    attendeeId?: string;
    trackId?: string;
    roomId?: string;
    otherTrackId?: string;
    sessionIds?: string[];
    publishedSessionId?: string;
    otherSessionId?: string;
  } = {};
  let dbReady = false;

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      console.warn("[sessionsBulkAssign.db.test] DATABASE_URL unreachable — skipping DB tests");
      return;
    }
    dbReady = true;

    const passwordHash = await hashPassword("TestPass12!x");
    const stamp = Date.now();

    const admin = await prisma.user.create({
      data: { email: `ba-admin-${stamp}@example.com`, name: "BA Admin", passwordHash, role: "ADMIN" },
    });
    const attendee = await prisma.user.create({
      data: { email: `ba-att-${stamp}@example.com`, name: "BA Attendee", passwordHash, role: "ATTENDEE" },
    });
    ids.adminId = admin.id;
    ids.attendeeId = attendee.id;

    const org = await prisma.organization.create({
      data: {
        name: `BA Org ${stamp}`,
        slug: `ba-org-${stamp}`,
        memberships: { create: { userId: admin.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;

    const now = new Date();
    const startDate = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const endDate = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);

    const event = await prisma.event.create({
      data: {
        name: `BA Event ${stamp}`,
        slug: `ba-evt-${stamp}`,
        timezone: "UTC",
        startDate,
        endDate,
        status: EventStatus.ACTIVE,
        organizationId: org.id,
        createdById: admin.id,
        memberships: {
          create: [
            { userId: admin.id, role: EventMemberRole.ADMIN },
            { userId: attendee.id, role: EventMemberRole.ATTENDEE },
          ],
        },
      },
    });
    ids.eventId = event.id;

    const otherEvent = await prisma.event.create({
      data: {
        name: `BA Other Event ${stamp}`,
        slug: `ba-evt2-${stamp}`,
        timezone: "UTC",
        startDate,
        endDate,
        status: EventStatus.ACTIVE,
        organizationId: org.id,
        createdById: admin.id,
      },
    });
    ids.otherEventId = otherEvent.id;

    const track = await prisma.track.create({
      data: { eventId: event.id, name: "PhD", color: "#0960ab" },
    });
    ids.trackId = track.id;
    const room = await prisma.room.create({
      data: { eventId: event.id, name: "Hall A" },
    });
    ids.roomId = room.id;
    const otherTrack = await prisma.track.create({
      data: { eventId: otherEvent.id, name: "Other", color: "#07662b" },
    });
    ids.otherTrackId = otherTrack.id;

    const mkSession = (title: string, eventId: string, publishStatus: SessionPublishStatus) =>
      prisma.session.create({
        data: {
          eventId,
          title,
          publishStatus,
          startsAt: new Date(now.getTime() + 60 * 60_000),
          endsAt: new Date(now.getTime() + 120 * 60_000),
        },
      });

    const s1 = await mkSession("BA Session 1", event.id, SessionPublishStatus.DRAFT);
    const s2 = await mkSession("BA Session 2", event.id, SessionPublishStatus.DRAFT);
    const s3 = await mkSession("BA Session 3 (published)", event.id, SessionPublishStatus.PUBLISHED);
    const other = await mkSession("BA Other-Event Session", otherEvent.id, SessionPublishStatus.DRAFT);
    ids.sessionIds = [s1.id, s2.id];
    ids.publishedSessionId = s3.id;
    ids.otherSessionId = other.id;
  });

  afterAll(async () => {
    if (!dbReady) {
      await prisma.$disconnect();
      return;
    }
    for (const eventId of [ids.eventId, ids.otherEventId]) {
      if (!eventId) continue;
      await prisma.sessionScheduleChange.deleteMany({ where: { eventId } });
      await prisma.session.deleteMany({ where: { eventId } });
      await prisma.track.deleteMany({ where: { eventId } });
      await prisma.room.deleteMany({ where: { eventId } });
      await prisma.eventMembership.deleteMany({ where: { eventId } });
      await prisma.event.delete({ where: { id: eventId } }).catch(() => undefined);
    }
    if (ids.orgId) {
      await prisma.orgMembership.deleteMany({ where: { organizationId: ids.orgId } });
      await prisma.organization.delete({ where: { id: ids.orgId } }).catch(() => undefined);
    }
    for (const uid of [ids.adminId, ids.attendeeId]) {
      if (uid) await prisma.user.delete({ where: { id: uid } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it("rejects a non-manager (attendee) at the route's guard", async () => {
    if (!dbReady) return;
    await expect(
      requireEventAccess(ids.attendeeId!, ids.eventId!, { manage: true }),
    ).rejects.toMatchObject({ status: 403 });
    // The owning-org admin passes the same guard.
    const access = await requireEventAccess(ids.adminId!, ids.eventId!, { manage: true });
    expect(access.canManageEvent).toBe(true);
  });

  it("assigns a track to many sessions in one call", async () => {
    if (!dbReady) return;
    const result = await bulkAssignSessions(prisma, {
      eventId: ids.eventId!,
      sessionIds: ids.sessionIds!,
      trackId: ids.trackId!,
    });
    expect(result.updatedCount).toBe(2);
    const rows = await prisma.session.findMany({
      where: { id: { in: ids.sessionIds! } },
      select: { trackId: true },
    });
    expect(rows.every((r) => r.trackId === ids.trackId)).toBe(true);
  });

  it("clears a track with trackId: null", async () => {
    if (!dbReady) return;
    await bulkAssignSessions(prisma, {
      eventId: ids.eventId!,
      sessionIds: [ids.sessionIds![0]!],
      trackId: null,
    });
    const row = await prisma.session.findUnique({
      where: { id: ids.sessionIds![0]! },
      select: { trackId: true },
    });
    expect(row?.trackId).toBeNull();
  });

  it("rejects session ids that belong to another event", async () => {
    if (!dbReady) return;
    await expect(
      bulkAssignSessions(prisma, {
        eventId: ids.eventId!,
        sessionIds: [ids.sessionIds![0]!, ids.otherSessionId!],
        trackId: ids.trackId!,
      }),
    ).rejects.toMatchObject({ status: 400 });
    const other = await prisma.session.findUnique({
      where: { id: ids.otherSessionId! },
      select: { trackId: true },
    });
    expect(other?.trackId).toBeNull();
  });

  it("rejects a track that belongs to another event", async () => {
    if (!dbReady) return;
    await expect(
      bulkAssignSessions(prisma, {
        eventId: ids.eventId!,
        sessionIds: [ids.sessionIds![0]!],
        trackId: ids.otherTrackId!,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("records a schedule change when a PUBLISHED session's room changes", async () => {
    if (!dbReady) return;
    const result = await bulkAssignSessions(prisma, {
      eventId: ids.eventId!,
      sessionIds: [ids.publishedSessionId!, ids.sessionIds![1]!],
      roomId: ids.roomId!,
    });
    expect(result.updatedCount).toBe(2);
    const changes = await prisma.sessionScheduleChange.findMany({
      where: { eventId: ids.eventId! },
    });
    // Only the PUBLISHED session generates a feed row; drafts never do.
    expect(changes).toHaveLength(1);
    expect(changes[0]!.sessionId).toBe(ids.publishedSessionId);
    expect(changes[0]!.newRoomId).toBe(ids.roomId);
  });

  it("requires at least one of trackId/roomId", async () => {
    if (!dbReady) return;
    let err: unknown;
    try {
      await bulkAssignSessions(prisma, { eventId: ids.eventId!, sessionIds: ids.sessionIds! });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(HttpError);
  });
});
