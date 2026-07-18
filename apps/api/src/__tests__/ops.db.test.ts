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
  ModerationReportStatus,
  NotificationKind,
  OrgRole,
  PrismaClient,
  SessionAttendanceStatus,
  SessionJoinMode,
  SessionPublishStatus,
} from "@prisma/client";
import { hashPassword } from "../lib/auth";
import {
  applyOpsCard,
  createOpsCardIfAbsent,
  detectCapacityPressure,
  detectDailyDigest,
  detectLowCheckin,
  detectModeration,
  detectQaStale,
  detectSessionChanged,
  dismissOpsCard,
  MockAiProvider,
  recordSessionScheduleChange,
  resetAiProviderForTests,
  runOpsDetectorsForEvent,
} from "../lib/ai";
import { applyPlanSkuToOrg } from "../lib/billing/entitlements";
import { upsertFeatureOverrides } from "../lib/features/featureEnabled";

describe("Ops agent (DB)", () => {
  const prisma = new PrismaClient();
  const ids: {
    orgId?: string;
    eventId?: string;
    adminId?: string;
    attendeeId?: string;
    speakerUserId?: string;
    sessionId?: string;
    smallRoomId?: string;
    largeRoomId?: string;
  } = {};
  let dbReady = false;

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await prisma.opsInboxCard.findFirst();
      await prisma.sessionScheduleChange.findFirst();
    } catch {
      console.warn("[ops.db.test] DB unreachable or A5 tables missing — skipping");
      return;
    }
    dbReady = true;
    process.env.AI_PROVIDER = "mock";
    resetAiProviderForTests(new MockAiProvider());

    const passwordHash = await hashPassword("TestPass12!x");
    const stamp = Date.now();

    const admin = await prisma.user.create({
      data: {
        email: `ops-admin-${stamp}@example.com`,
        name: "Ops Admin",
        passwordHash,
        role: "ADMIN",
      },
    });
    const attendee = await prisma.user.create({
      data: {
        email: `ops-att-${stamp}@example.com`,
        name: "Ops Attendee",
        passwordHash,
        role: "ATTENDEE",
      },
    });
    const speakerUser = await prisma.user.create({
      data: {
        email: `ops-spk-${stamp}@example.com`,
        name: "Ops Speaker",
        passwordHash,
        role: "SPEAKER",
      },
    });
    ids.adminId = admin.id;
    ids.attendeeId = attendee.id;
    ids.speakerUserId = speakerUser.id;

    const org = await prisma.organization.create({
      data: {
        name: `Ops Org ${stamp}`,
        slug: `ops-org-${stamp}`,
        memberships: { create: { userId: admin.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;
    await applyPlanSkuToOrg(org.id, "pro_annual");

    const now = new Date();
    const startDate = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const endDate = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);

    const event = await prisma.event.create({
      data: {
        name: `Ops Event ${stamp}`,
        slug: `ops-evt-${stamp}`,
        timezone: "UTC",
        startDate,
        endDate,
        status: EventStatus.ACTIVE,
        organizationId: org.id,
        createdById: admin.id,
        communityBlocklist: ["forbiddenphrase"],
        memberships: {
          create: [
            { userId: admin.id, role: EventMemberRole.ADMIN },
            { userId: attendee.id, role: EventMemberRole.ATTENDEE },
            { userId: speakerUser.id, role: EventMemberRole.SPEAKER },
          ],
        },
      },
    });
    ids.eventId = event.id;
    await upsertFeatureOverrides(event.id, { ops_agent: true, checkin: true, session_qa: true });

    const smallRoom = await prisma.room.create({
      data: { eventId: event.id, name: "Small", capacity: 10, sortOrder: 0 },
    });
    const largeRoom = await prisma.room.create({
      data: { eventId: event.id, name: "Large Hall", capacity: 100, sortOrder: 1 },
    });
    ids.smallRoomId = smallRoom.id;
    ids.largeRoomId = largeRoom.id;

    const session = await prisma.session.create({
      data: {
        eventId: event.id,
        title: "Masterclass 1",
        publishStatus: SessionPublishStatus.PUBLISHED,
        startsAt: new Date(now.getTime() + 30 * 60_000),
        endsAt: new Date(now.getTime() + 90 * 60_000),
        roomId: smallRoom.id,
        speakerId: speakerUser.id,
        inPersonCapacity: 10,
        allowVirtualJoin: false,
      },
    });
    ids.sessionId = session.id;
  });

  afterAll(async () => {
    if (!dbReady) {
      await prisma.$disconnect();
      return;
    }
    const eventId = ids.eventId;
    if (eventId) {
      await prisma.opsInboxCard.deleteMany({ where: { eventId } });
      await prisma.sessionScheduleChange.deleteMany({ where: { eventId } });
      await prisma.userNotification.deleteMany({ where: { eventId } });
      await prisma.announcementAuditLog.deleteMany({ where: { eventId } });
      await prisma.announcement.deleteMany({ where: { eventId } });
      await prisma.sessionDiscussionReply.deleteMany({
        where: { thread: { session: { eventId } } },
      });
      await prisma.sessionDiscussionThread.deleteMany({ where: { session: { eventId } } });
      await prisma.waitlistEntry.deleteMany({ where: { session: { eventId } } });
      await prisma.sessionAttendance.deleteMany({ where: { session: { eventId } } });
      await prisma.checkIn.deleteMany({ where: { eventId } });
      await prisma.networkReply.deleteMany({ where: { thread: { eventId } } });
      await prisma.networkThread.deleteMany({ where: { eventId } });
      await prisma.userReport.deleteMany({ where: { eventId } });
      await prisma.conversationMessage.deleteMany({ where: { conversation: { eventId } } });
      await prisma.conversationMember.deleteMany({ where: { conversation: { eventId } } });
      await prisma.conversation.deleteMany({ where: { eventId } });
      await prisma.auditLog.deleteMany({ where: { eventId } });
      await prisma.aiUsageRecord.deleteMany({ where: { eventId } });
      await prisma.session.deleteMany({ where: { eventId } });
      await prisma.room.deleteMany({ where: { eventId } });
      await prisma.eventMembership.deleteMany({ where: { eventId } });
      await prisma.eventFeatureConfig.deleteMany({ where: { eventId } });
      await prisma.event.delete({ where: { id: eventId } }).catch(() => undefined);
    }
    if (ids.orgId) {
      await prisma.orgMembership.deleteMany({ where: { organizationId: ids.orgId } });
      await prisma.organization.delete({ where: { id: ids.orgId } }).catch(() => undefined);
    }
    for (const uid of [ids.adminId, ids.attendeeId, ids.speakerUserId]) {
      if (uid) await prisma.user.delete({ where: { id: uid } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  function skipIfNoDb() {
    if (!dbReady) return true;
    return false;
  }

  it("session-change detector fires on feed row and not when unpublished", async () => {
    if (skipIfNoDb()) return;
    const session = await prisma.session.findUniqueOrThrow({ where: { id: ids.sessionId! } });
    const change = await recordSessionScheduleChange({
      eventId: ids.eventId!,
      sessionId: session.id,
      publishStatus: "PUBLISHED",
      previousStartsAt: session.startsAt,
      newStartsAt: new Date(session.startsAt.getTime() + 60 * 60_000),
      previousRoomId: session.roomId,
      newRoomId: ids.largeRoomId!,
    });
    expect(change).not.toBeNull();

    const pos = await detectSessionChanged(ids.eventId!, ids.orgId!);
    expect(pos.created).toBeGreaterThanOrEqual(1);

    const draftRow = await prisma.session.create({
      data: {
        eventId: ids.eventId!,
        title: "Draft only",
        publishStatus: SessionPublishStatus.DRAFT,
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 3600_000),
      },
    });
    const draftChange = await recordSessionScheduleChange({
      eventId: ids.eventId!,
      sessionId: draftRow.id,
      publishStatus: "DRAFT",
      previousStartsAt: draftRow.startsAt,
      newStartsAt: new Date(draftRow.startsAt.getTime() + 3600_000),
      previousRoomId: null,
      newRoomId: null,
    });
    expect(draftChange).toBeNull();

    const before = await prisma.opsInboxCard.count({
      where: { eventId: ids.eventId!, detectorKind: "SESSION_CHANGED" },
    });
    await detectSessionChanged(ids.eventId!, ids.orgId!);
    const after = await prisma.opsInboxCard.count({
      where: { eventId: ids.eventId!, detectorKind: "SESSION_CHANGED" },
    });
    expect(after).toBe(before);
  });

  it("Q&A stale fires >3h on event day and not under 3h", async () => {
    if (skipIfNoDb()) return;
    const now = new Date();
    const stale = await prisma.sessionDiscussionThread.create({
      data: {
        sessionId: ids.sessionId!,
        authorId: ids.attendeeId!,
        title: "Stale question",
        body: "Waiting a while",
        createdAt: new Date(now.getTime() - 4 * 60 * 60_000),
      },
    });
    const fresh = await prisma.sessionDiscussionThread.create({
      data: {
        sessionId: ids.sessionId!,
        authorId: ids.attendeeId!,
        title: "Fresh question",
        body: "Just asked",
        createdAt: new Date(now.getTime() - 30 * 60_000),
      },
    });

    const result = await detectQaStale(ids.eventId!, ids.orgId!, { now });
    expect(result.created).toBeGreaterThanOrEqual(1);
    const staleCard = await prisma.opsInboxCard.findUnique({
      where: {
        eventId_triggerInstanceKey: {
          eventId: ids.eventId!,
          triggerInstanceKey: `qa_stale:${stale.id}`,
        },
      },
    });
    expect(staleCard).not.toBeNull();
    const freshCard = await prisma.opsInboxCard.findUnique({
      where: {
        eventId_triggerInstanceKey: {
          eventId: ids.eventId!,
          triggerInstanceKey: `qa_stale:${fresh.id}`,
        },
      },
    });
    expect(freshCard).toBeNull();
  });

  it("low check-in fires under 25% and not at/above 25%", async () => {
    if (skipIfNoDb()) return;
    const now = new Date();
    const startsAt = new Date(now.getTime() + 30 * 60_000);

    // 4 joiners, 0 check-ins → 0% → fire
    const lowSession = await prisma.session.create({
      data: {
        eventId: ids.eventId!,
        title: "Low check-in session",
        publishStatus: SessionPublishStatus.PUBLISHED,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3600_000),
      },
    });
    const joiners = [ids.attendeeId!, ids.adminId!, ids.speakerUserId!];
    // need 4th user
    const extra = await prisma.user.create({
      data: {
        email: `ops-extra-${Date.now()}@example.com`,
        name: "Extra",
        passwordHash: await hashPassword("TestPass12!x"),
        role: "ATTENDEE",
      },
    });
    await prisma.eventMembership.create({
      data: { eventId: ids.eventId!, userId: extra.id, role: EventMemberRole.ATTENDEE },
    });
    joiners.push(extra.id);
    for (const userId of joiners) {
      await prisma.sessionAttendance.create({
        data: {
          sessionId: lowSession.id,
          userId,
          status: SessionAttendanceStatus.JOINING,
          joinMode: SessionJoinMode.IN_PERSON,
        },
      });
    }

    const low = await detectLowCheckin(ids.eventId!, ids.orgId!, { now });
    expect(low.created).toBeGreaterThanOrEqual(1);

    // Boundary: 1/4 = 25% should NOT fire for a different session
    const okSession = await prisma.session.create({
      data: {
        eventId: ids.eventId!,
        title: "Ok check-in session",
        publishStatus: SessionPublishStatus.PUBLISHED,
        startsAt: new Date(startsAt.getTime() + 60_000),
        endsAt: new Date(startsAt.getTime() + 3600_000),
      },
    });
    for (const userId of joiners) {
      await prisma.sessionAttendance.create({
        data: {
          sessionId: okSession.id,
          userId,
          status: SessionAttendanceStatus.JOINING,
          joinMode: SessionJoinMode.IN_PERSON,
        },
      });
    }
    await prisma.checkIn.create({
      data: { eventId: ids.eventId!, userId: joiners[0]! },
    });
    const before = await prisma.opsInboxCard.count({
      where: { eventId: ids.eventId!, detectorKind: "LOW_CHECKIN" },
    });
    await detectLowCheckin(ids.eventId!, ids.orgId!, { now });
    const okCard = await prisma.opsInboxCard.findFirst({
      where: {
        eventId: ids.eventId!,
        triggerInstanceKey: { startsWith: `low_checkin:${okSession.id}:` },
      },
    });
    expect(okCard).toBeNull();
    const after = await prisma.opsInboxCard.count({
      where: { eventId: ids.eventId!, detectorKind: "LOW_CHECKIN" },
    });
    // May create for lowSession again? No — sticky unique key. after >= before.
    expect(after).toBe(before);
  });

  it("capacity pressure fires >90% with waitlist; suggests larger free room", async () => {
    if (skipIfNoDb()) return;
    const session = await prisma.session.findUniqueOrThrow({ where: { id: ids.sessionId! } });
    // Fill 10/10 and add waitlist
    const users = await prisma.eventMembership.findMany({
      where: { eventId: ids.eventId! },
      select: { userId: true },
    });
    // Ensure 10 attendances — create extras if needed
    const needed = 10;
    const attendeeIds = [...users.map((u) => u.userId)];
    while (attendeeIds.length < needed) {
      const u = await prisma.user.create({
        data: {
          email: `ops-cap-${Date.now()}-${attendeeIds.length}@example.com`,
          name: "Cap",
          passwordHash: await hashPassword("TestPass12!x"),
          role: "ATTENDEE",
        },
      });
      await prisma.eventMembership.create({
        data: { eventId: ids.eventId!, userId: u.id, role: EventMemberRole.ATTENDEE },
      });
      attendeeIds.push(u.id);
    }
    await prisma.sessionAttendance.deleteMany({ where: { sessionId: session.id } });
    for (let i = 0; i < needed; i += 1) {
      await prisma.sessionAttendance.create({
        data: {
          sessionId: session.id,
          userId: attendeeIds[i]!,
          status: SessionAttendanceStatus.JOINING,
          joinMode: SessionJoinMode.IN_PERSON,
        },
      });
    }
    // Fresh waitlisted user (must not already be JOINING)
    const wlUser = await prisma.user.create({
      data: {
        email: `ops-wl-${Date.now()}@example.com`,
        name: "Waitlisted",
        passwordHash: await hashPassword("TestPass12!x"),
        role: "ATTENDEE",
      },
    });
    await prisma.eventMembership.create({
      data: { eventId: ids.eventId!, userId: wlUser.id, role: EventMemberRole.ATTENDEE },
    });
    await prisma.waitlistEntry.create({
      data: {
        sessionId: session.id,
        userId: wlUser.id,
        mode: SessionJoinMode.IN_PERSON,
        position: 1,
      },
    });

    const result = await detectCapacityPressure(ids.eventId!, ids.orgId!);
    expect(result.created).toBeGreaterThanOrEqual(1);
    const card = await prisma.opsInboxCard.findUnique({
      where: {
        eventId_triggerInstanceKey: {
          eventId: ids.eventId!,
          triggerInstanceKey: `capacity:${session.id}:IN_PERSON`,
        },
      },
    });
    expect(card).not.toBeNull();
    expect(card!.draftActionType).toBe("ROOM_MOVE");
    const payload = card!.draftPayload as { suggestedRoomId?: string };
    expect(payload.suggestedRoomId).toBe(ids.largeRoomId);

    // Boundary: no waitlist → no new card for another session at 100%
    const noWl = await prisma.session.create({
      data: {
        eventId: ids.eventId!,
        title: "Full no waitlist",
        publishStatus: SessionPublishStatus.PUBLISHED,
        startsAt: new Date(Date.now() + 5 * 3600_000),
        endsAt: new Date(Date.now() + 6 * 3600_000),
        inPersonCapacity: 1,
        roomId: ids.smallRoomId,
      },
    });
    await prisma.sessionAttendance.create({
      data: {
        sessionId: noWl.id,
        userId: ids.attendeeId!,
        status: SessionAttendanceStatus.JOINING,
        joinMode: SessionJoinMode.IN_PERSON,
      },
    });
    await detectCapacityPressure(ids.eventId!, ids.orgId!);
    const noWlCard = await prisma.opsInboxCard.findUnique({
      where: {
        eventId_triggerInstanceKey: {
          eventId: ids.eventId!,
          triggerInstanceKey: `capacity:${noWl.id}:IN_PERSON`,
        },
      },
    });
    expect(noWlCard).toBeNull();
  });

  it("moderation fires on OPEN report and blocklist hit; not on resolved report", async () => {
    if (skipIfNoDb()) return;
    const open = await prisma.userReport.create({
      data: {
        eventId: ids.eventId!,
        reporterId: ids.attendeeId!,
        reportedUserId: ids.speakerUserId!,
        reason: "Harassment",
        status: ModerationReportStatus.OPEN,
      },
    });
    const resolved = await prisma.userReport.create({
      data: {
        eventId: ids.eventId!,
        reporterId: ids.attendeeId!,
        reportedUserId: ids.adminId!,
        reason: "Old",
        status: ModerationReportStatus.DISMISSED,
      },
    });
    const thread = await prisma.networkThread.create({
      data: {
        eventId: ids.eventId!,
        authorId: ids.attendeeId!,
        title: "Hello",
        body: "This has a forbiddenphrase in it",
        channel: "GENERAL",
      },
    });

    const result = await detectModeration(ids.eventId!, ids.orgId!);
    expect(result.created).toBeGreaterThanOrEqual(2);
    expect(
      await prisma.opsInboxCard.findUnique({
        where: {
          eventId_triggerInstanceKey: {
            eventId: ids.eventId!,
            triggerInstanceKey: `moderation:report:${open.id}`,
          },
        },
      }),
    ).not.toBeNull();
    expect(
      await prisma.opsInboxCard.findUnique({
        where: {
          eventId_triggerInstanceKey: {
            eventId: ids.eventId!,
            triggerInstanceKey: `moderation:report:${resolved.id}`,
          },
        },
      }),
    ).toBeNull();
    expect(
      await prisma.opsInboxCard.findUnique({
        where: {
          eventId_triggerInstanceKey: {
            eventId: ids.eventId!,
            triggerInstanceKey: `moderation:blocklist:thread:${thread.id}`,
          },
        },
      }),
    ).not.toBeNull();
  });

  it("daily digest creates once per local day", async () => {
    if (skipIfNoDb()) return;
    const now = new Date();
    const first = await detectDailyDigest(ids.eventId!, ids.orgId!, { now, force: true });
    expect(first.created).toBe(1);
    const second = await detectDailyDigest(ids.eventId!, ids.orgId!, { now, force: true });
    expect(second.created).toBe(0);
  });

  it("dismissal is sticky — trigger key never recreates", async () => {
    if (skipIfNoDb()) return;
    const key = `test_sticky:${Date.now()}`;
    const { card, created } = await createOpsCardIfAbsent({
      organizationId: ids.orgId!,
      eventId: ids.eventId!,
      detectorKind: "DAILY_DIGEST",
      triggerInstanceKey: key,
      triggerSummary: "Sticky test",
      evidence: {},
      draftActionType: "DIGEST_NOTE",
      draftPayload: {},
      draftHint: { title: "Sticky", body: "Body" },
    });
    expect(created).toBe(true);
    expect(card).not.toBeNull();

    await dismissOpsCard({
      cardId: card!.id,
      eventId: ids.eventId!,
      actorUserId: ids.adminId!,
    });

    const again = await createOpsCardIfAbsent({
      organizationId: ids.orgId!,
      eventId: ids.eventId!,
      detectorKind: "DAILY_DIGEST",
      triggerInstanceKey: key,
      triggerSummary: "Sticky test again",
      evidence: {},
      draftActionType: "DIGEST_NOTE",
      draftPayload: {},
      draftHint: { title: "Sticky", body: "Body" },
    });
    expect(again.created).toBe(false);
    expect(again.card?.status).toBe("DISMISSED");
  });

  it("Send delivers announcement via existing channel; audit log written; no autonomous apply", async () => {
    if (skipIfNoDb()) return;
    // Ensure a joiner on Masterclass for announcement recipients
    await prisma.sessionAttendance.upsert({
      where: {
        userId_sessionId: { userId: ids.attendeeId!, sessionId: ids.sessionId! },
      },
      create: {
        userId: ids.attendeeId!,
        sessionId: ids.sessionId!,
        status: SessionAttendanceStatus.JOINING,
        joinMode: SessionJoinMode.IN_PERSON,
      },
      update: { status: SessionAttendanceStatus.JOINING },
    });

    const { card } = await createOpsCardIfAbsent({
      organizationId: ids.orgId!,
      eventId: ids.eventId!,
      detectorKind: "SESSION_CHANGED",
      triggerInstanceKey: `manual_send:${Date.now()}`,
      triggerSummary: "Manual send test",
      evidence: { sessionId: ids.sessionId },
      draftActionType: "ANNOUNCEMENT",
      draftPayload: {
        audience: "SESSION_JOINERS",
        sessionId: ids.sessionId,
        notificationKind: "SESSION_CHANGED",
        sameDaySessionChange: true,
      },
      draftHint: { title: "Room moved", body: "Please go to Large Hall." },
    });
    expect(card).not.toBeNull();

    // Prove detectors did not apply it
    const stillOpen = await prisma.opsInboxCard.findUniqueOrThrow({ where: { id: card!.id } });
    expect(stillOpen.status).toBe("OPEN");

    const beforeNotifs = await prisma.userNotification.count({
      where: { eventId: ids.eventId!, kind: NotificationKind.SESSION_CHANGED },
    });

    const applied = await applyOpsCard({
      cardId: card!.id,
      eventId: ids.eventId!,
      actorUserId: ids.adminId!,
    });
    expect(applied.card.status).toBe("APPLIED");
    expect(applied.channelRef).toBeTruthy();

    const afterNotifs = await prisma.userNotification.count({
      where: { eventId: ids.eventId!, kind: NotificationKind.SESSION_CHANGED },
    });
    expect(afterNotifs).toBeGreaterThan(beforeNotifs);

    const audit = await prisma.auditLog.findFirst({
      where: {
        eventId: ids.eventId!,
        entityType: "OpsInboxCard",
        entityId: card!.id,
        action: "AI_NOTIFY",
      },
    });
    expect(audit).not.toBeNull();
    expect(audit!.aiGenerated).toBe(true);
    const payload = audit!.payload as { evidenceSnapshot?: unknown; draftTitle?: string };
    expect(payload.draftTitle || (payload as { appliedResult?: unknown }).appliedResult).toBeTruthy();
  });

  it("runOpsDetectorsForEvent never leaves cards APPLIED without applyOpsCard", async () => {
    if (skipIfNoDb()) return;
    await runOpsDetectorsForEvent(ids.eventId!, { forceDigest: true });
    const appliedWithoutActor = await prisma.opsInboxCard.findMany({
      where: {
        eventId: ids.eventId!,
        status: "APPLIED",
        appliedById: null,
      },
    });
    expect(appliedWithoutActor).toHaveLength(0);
  });
});
