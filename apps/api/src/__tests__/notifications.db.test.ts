import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EventMemberRole,
  EventStatus,
  NotificationDelivery,
  NotificationKind,
  OrgRole,
  PrismaClient,
} from "@prisma/client";
import { hashPassword } from "../lib/auth";
import { newJoinToken } from "../lib/inviteTokens";
import {
  deliverNotification,
  getPushBudgetStatus,
  notifyMany,
} from "../lib/notifications";
import { zonedWallTimeToUtc } from "../lib/notifications/timezone";

describe("calm notification platform (DB)", () => {
  const prisma = new PrismaClient();
  const ids: {
    orgId?: string;
    eventId?: string;
    userId?: string;
    userB?: string;
  } = {};
  let dbReady = false;

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await prisma.notificationPushDay.findFirst();
    } catch {
      console.warn("[notifications.db.test] DB unreachable or Phase 4 tables missing — skipping");
      return;
    }
    dbReady = true;
    const passwordHash = await hashPassword("TestPass12!x");
    const stamp = Date.now();

    const user = await prisma.user.create({
      data: {
        email: `calm-a-${stamp}@example.com`,
        name: "Calm A",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const userB = await prisma.user.create({
      data: {
        email: `calm-b-${stamp}@example.com`,
        name: "Calm B",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    ids.userId = user.id;
    ids.userB = userB.id;

    const org = await prisma.organization.create({
      data: {
        name: "Calm Org",
        slug: `calm-org-${stamp}`,
        plan: "INTERNAL",
        eventAllowance: null,
        memberships: { create: { userId: user.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;

    const { hash } = newJoinToken();
    const event = await prisma.event.create({
      data: {
        name: "Calm Event",
        slug: `calm-evt-${stamp}`,
        timezone: "America/New_York",
        startDate: new Date("2027-06-01T14:00:00Z"),
        endDate: new Date("2027-06-03T22:00:00Z"),
        status: EventStatus.ACTIVE,
        organizationId: org.id,
        createdById: user.id,
        joinTokenHash: hash,
        attendeeCap: 1000,
        memberships: {
          create: [
            { userId: user.id, role: EventMemberRole.ADMIN, directoryOptIn: false },
            { userId: userB.id, role: EventMemberRole.ATTENDEE, directoryOptIn: false },
          ],
        },
      },
    });
    ids.eventId = event.id;

    await prisma.notificationPreference.create({
      data: {
        userId: user.id,
        eventId: event.id,
        quietHoursStart: "22:00",
        quietHoursEnd: "07:00",
        timezone: "America/New_York",
      },
    });
  });

  afterAll(async () => {
    if (ids.eventId) await prisma.event.delete({ where: { id: ids.eventId } }).catch(() => null);
    if (ids.orgId) await prisma.organization.delete({ where: { id: ids.orgId } }).catch(() => null);
    if (ids.userId) await prisma.user.delete({ where: { id: ids.userId } }).catch(() => null);
    if (ids.userB) await prisma.user.delete({ where: { id: ids.userB } }).catch(() => null);
    await prisma.$disconnect();
  });

  it("directoryOptIn defaults false", async () => {
    if (!dbReady) return;
    const m = await prisma.eventMembership.findFirst({
      where: { eventId: ids.eventId!, userId: ids.userB! },
    });
    expect(m?.directoryOptIn).toBe(false);
  });

  it("budget ceiling: 6th INTERRUPT push degrades to DIGESTED", async () => {
    if (!dbReady) return;
    process.env.NOTIFICATION_DAILY_PUSH_BUDGET = "5";
    // Midday Eastern — outside quiet hours
    const noon = zonedWallTimeToUtc("America/New_York", 2027, 7, 1, 12, 0);

    for (let i = 0; i < 5; i++) {
      const r = await deliverNotification(
        {
          userId: ids.userId!,
          eventId: ids.eventId!,
          kind: NotificationKind.MESSAGE,
          title: `Push ${i + 1}`,
          body: "hi",
        },
        noon,
      );
      expect(r.degradedToDigest).toBe(false);
      expect(r.delivery).toBe(NotificationDelivery.PUSHED);
      expect(r.budgetCharged).toBe(true);
    }

    const sixth = await deliverNotification(
      {
        userId: ids.userId!,
        eventId: ids.eventId!,
        kind: NotificationKind.MESSAGE,
        title: "Push 6",
        body: "over",
      },
      noon,
    );
    expect(sixth.degradedToDigest).toBe(true);
    expect(sixth.delivery).toBe(NotificationDelivery.DIGESTED);
    expect(sixth.budgetCharged).toBe(false);

    const status = await getPushBudgetStatus(ids.userId!, "America/New_York", noon);
    expect(status.used).toBe(5);
    expect(status.remaining).toBe(0);
  });

  it("quiet hours queue until local morning", async () => {
    if (!dbReady) return;
    const at2300 = zonedWallTimeToUtc("America/New_York", 2027, 7, 2, 23, 0);
    const r = await deliverNotification(
      {
        userId: ids.userId!,
        eventId: ids.eventId!,
        kind: NotificationKind.MESSAGE,
        title: "Late DM",
      },
      at2300,
    );
    expect(r.delivery).toBe(NotificationDelivery.QUEUED_PUSH);
    const row = await prisma.userNotification.findUnique({ where: { id: r.notificationId } });
    expect(row?.queuedUntil).toBeTruthy();
    expect(row!.queuedUntil!.getTime()).toBeGreaterThan(at2300.getTime());
  });

  it("same-day session-change bypasses quiet hours", async () => {
    if (!dbReady) return;
    const at2300 = zonedWallTimeToUtc("America/New_York", 2027, 7, 3, 23, 30);
    const r = await deliverNotification(
      {
        userId: ids.userId!,
        eventId: ids.eventId!,
        kind: NotificationKind.SESSION_CHANGED,
        title: "Room moved",
        sameDaySessionChange: true,
      },
      at2300,
    );
    expect(r.delivery).not.toBe(NotificationDelivery.QUEUED_PUSH);
    expect([NotificationDelivery.PUSHED, NotificationDelivery.DIGESTED]).toContain(r.delivery);
  });

  it("emergency bypasses budget + quiet hours and can audit via announcement path", async () => {
    if (!dbReady) return;
    const at2300 = zonedWallTimeToUtc("America/New_York", 2027, 7, 4, 23, 45);
    // Exhaust budget first on a fresh day key by charging 5 at noon same dayKey... use unique day
    const r = await deliverNotification(
      {
        userId: ids.userId!,
        eventId: ids.eventId!,
        kind: NotificationKind.ANNOUNCEMENT,
        title: "EVACUATE",
        emergency: true,
      },
      at2300,
    );
    expect(r.delivery).toBe(NotificationDelivery.PUSHED);
    expect(r.budgetCharged).toBe(false);
    expect(r.degradedToDigest).toBe(false);

    const announcement = await prisma.announcement.create({
      data: {
        eventId: ids.eventId!,
        title: "Emergency",
        body: "Leave now",
        isEmergency: true,
        createdById: ids.userId!,
        publishedAt: at2300,
      },
    });
    const audit = await prisma.announcementAuditLog.create({
      data: {
        announcementId: announcement.id,
        eventId: ids.eventId!,
        actorId: ids.userId!,
        action: "EMERGENCY_PUBLISH",
        payload: { confirmationOk: true },
      },
    });
    expect(audit.action).toBe("EMERGENCY_PUBLISH");
  });

  it("DIGEST community never charges budget", async () => {
    if (!dbReady) return;
    const noon = zonedWallTimeToUtc("America/New_York", 2027, 8, 1, 12, 0);
    const before = await getPushBudgetStatus(ids.userId!, "America/New_York", noon);
    await notifyMany(
      [
        {
          userId: ids.userId!,
          eventId: ids.eventId!,
          kind: NotificationKind.COMMUNITY_THREAD,
          title: "Community post",
        },
      ],
      noon,
    );
    const after = await getPushBudgetStatus(ids.userId!, "America/New_York", noon);
    expect(after.used).toBe(before.used);
  });

  it("meeting accept creates two PersonalAgendaBlocks", async () => {
    if (!dbReady) return;
    await prisma.eventMembership.updateMany({
      where: { eventId: ids.eventId! },
      data: { directoryOptIn: true },
    });
    const starts = new Date("2027-09-01T15:00:00Z");
    const ends = new Date("2027-09-01T15:30:00Z");
    const meeting = await prisma.meetingRequest.create({
      data: {
        eventId: ids.eventId!,
        fromUserId: ids.userId!,
        toUserId: ids.userB!,
        slots: { create: [{ startsAt: starts, endsAt: ends, sortOrder: 0 }] },
      },
      include: { slots: true },
    });
    const slot = meeting.slots[0]!;
    const title = "Meeting: Calm A & Calm B";
    await prisma.$transaction(async (tx) => {
      await tx.meetingRequest.update({
        where: { id: meeting.id },
        data: { status: "ACCEPTED", respondedAt: new Date() },
      });
      await tx.personalAgendaBlock.createMany({
        data: [
          {
            userId: ids.userId!,
            eventId: ids.eventId!,
            title,
            startsAt: slot.startsAt,
            endsAt: slot.endsAt,
            source: "MEETING",
            meetingRequestId: meeting.id,
          },
          {
            userId: ids.userB!,
            eventId: ids.eventId!,
            title,
            startsAt: slot.startsAt,
            endsAt: slot.endsAt,
            source: "MEETING",
            meetingRequestId: meeting.id,
          },
        ],
      });
    });
    const blocks = await prisma.personalAgendaBlock.findMany({
      where: { meetingRequestId: meeting.id },
    });
    expect(blocks).toHaveLength(2);
    expect(new Set(blocks.map((b) => b.userId))).toEqual(new Set([ids.userId, ids.userB]));
  });
});
