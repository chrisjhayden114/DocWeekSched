/**
 * DIGEST-W — periodic sweep that rolls unread digest items into a morning
 * digest per user/event (in-app only; email is never sent from this path).
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
  EventStatus,
  NotificationClass,
  NotificationDelivery,
  NotificationKind,
  OrgRole,
  PrismaClient,
} from "@prisma/client";
import { hashPassword } from "../lib/auth";
import { upsertFeatureOverrides } from "../lib/features/featureEnabled";
import { sweepDailyDigests } from "../lib/notifications/digestSweep";

describe("daily digest sweep (DB)", () => {
  const prisma = new PrismaClient();
  const ids: {
    orgId?: string;
    eventId?: string;
    eventOffId?: string;
    userA?: string;
    userLate?: string;
    userOff?: string;
  } = {};
  const now = new Date("2026-08-14T12:00:00Z");
  const inWindow = new Date("2026-08-14T02:00:00Z");

  beforeAll(async () => {
    const passwordHash = await hashPassword("TestPass12!x");
    const stamp = Date.now();

    const userA = await prisma.user.create({
      data: {
        email: `digw-a-${stamp}@example.com`,
        name: "Digest A",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const userLate = await prisma.user.create({
      data: {
        email: `digw-late-${stamp}@example.com`,
        name: "Digest Late",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const userOff = await prisma.user.create({
      data: {
        email: `digw-off-${stamp}@example.com`,
        name: "Digest Off",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    ids.userA = userA.id;
    ids.userLate = userLate.id;
    ids.userOff = userOff.id;

    // INTERNAL plan makes can(org, "daily_digest") always true — the plan gate is a no-op,
    // so this event's digest behavior is governed purely by feature flag + local time.
    const org = await prisma.organization.create({
      data: {
        name: `Digest Org ${stamp}`,
        slug: `digw-org-${stamp}`,
        plan: "INTERNAL",
        eventAllowance: null,
        memberships: { create: { userId: userA.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;

    const event = await prisma.event.create({
      data: {
        name: `Digest Event ${stamp}`,
        slug: `digw-evt-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2027-09-01T14:00:00Z"),
        endDate: new Date("2027-09-03T22:00:00Z"),
        status: EventStatus.ACTIVE,
        organizationId: org.id,
        createdById: userA.id,
        memberships: {
          create: [
            { userId: userA.id, role: EventMemberRole.ATTENDEE, directoryOptIn: true },
            { userId: userLate.id, role: EventMemberRole.ATTENDEE, directoryOptIn: true },
          ],
        },
      },
    });
    ids.eventId = event.id;

    const eventOff = await prisma.event.create({
      data: {
        name: `Digest Off Event ${stamp}`,
        slug: `digw-evt-off-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2027-09-01T14:00:00Z"),
        endDate: new Date("2027-09-03T22:00:00Z"),
        status: EventStatus.ACTIVE,
        organizationId: org.id,
        createdById: userA.id,
        memberships: {
          create: [{ userId: userOff.id, role: EventMemberRole.ATTENDEE, directoryOptIn: true }],
        },
      },
    });
    ids.eventOffId = eventOff.id;
    await upsertFeatureOverrides(eventOff.id, { daily_digest: false });

    await prisma.notificationPreference.create({
      data: { userId: userA.id, eventId: event.id, digestLocalTime: "08:00", timezone: "UTC" },
    });
    await prisma.notificationPreference.create({
      data: { userId: userLate.id, eventId: event.id, digestLocalTime: "23:00", timezone: "UTC" },
    });
  }, 60_000);

  afterAll(async () => {
    const eventIds = [ids.eventId, ids.eventOffId].filter((v): v is string => Boolean(v));
    if (eventIds.length) {
      await prisma.userNotification.deleteMany({ where: { eventId: { in: eventIds } } }).catch(() => null);
      await prisma.notificationPreference.deleteMany({ where: { eventId: { in: eventIds } } }).catch(() => null);
      await prisma.eventFeatureConfig.deleteMany({ where: { eventId: { in: eventIds } } }).catch(() => null);
      await prisma.eventMembership.deleteMany({ where: { eventId: { in: eventIds } } }).catch(() => null);
      await prisma.event.deleteMany({ where: { id: { in: eventIds } } }).catch(() => null);
    }
    if (ids.orgId) {
      await prisma.orgMembership.deleteMany({ where: { organizationId: ids.orgId } }).catch(() => null);
      await prisma.organization.delete({ where: { id: ids.orgId } }).catch(() => null);
    }
    for (const id of [ids.userA, ids.userLate, ids.userOff]) {
      if (id) await prisma.user.delete({ where: { id } }).catch(() => null);
    }
    await prisma.$disconnect();
  }, 60_000);

  function seedItem(userId: string, eventId: string, title: string) {
    return prisma.userNotification.create({
      data: {
        userId,
        eventId,
        kind: NotificationKind.ANNOUNCEMENT,
        class: NotificationClass.DIGEST,
        delivery: NotificationDelivery.INBOX,
        title,
        body: "",
        createdAt: inWindow,
      },
    });
  }

  it("rolls up unread items once per day and dedups on rerun", async () => {
    await seedItem(ids.userA!, ids.eventId!, "Item one");
    await seedItem(ids.userA!, ids.eventId!, "Item two");

    const first = await sweepDailyDigests(now);
    expect(first.rolled).toBe(1);

    const rollups = await prisma.userNotification.findMany({
      where: { userId: ids.userA!, eventId: ids.eventId!, kind: NotificationKind.DIGEST_ROLLUP },
    });
    expect(rollups).toHaveLength(1);
    expect(rollups[0]!.title.startsWith("Your daily digest —")).toBe(true);
    expect(rollups[0]!.body).toContain("Item one");
    expect(rollups[0]!.body).toContain("Item two");

    const second = await sweepDailyDigests(now);
    expect(second.rolled).toBe(0);

    const rollupsAfterRerun = await prisma.userNotification.findMany({
      where: { userId: ids.userA!, eventId: ids.eventId!, kind: NotificationKind.DIGEST_ROLLUP },
    });
    expect(rollupsAfterRerun).toHaveLength(1);
  }, 60_000);

  it("skips a user whose local digest time hasn't passed yet", async () => {
    await seedItem(ids.userLate!, ids.eventId!, "Late item");

    await sweepDailyDigests(now);

    const rollup = await prisma.userNotification.findFirst({
      where: { userId: ids.userLate!, eventId: ids.eventId!, kind: NotificationKind.DIGEST_ROLLUP },
    });
    expect(rollup).toBeNull();
  }, 60_000);

  it("skips an event with daily_digest disabled", async () => {
    await seedItem(ids.userOff!, ids.eventOffId!, "Off item");

    await sweepDailyDigests(now);

    const rollup = await prisma.userNotification.findFirst({
      where: { userId: ids.userOff!, eventId: ids.eventOffId!, kind: NotificationKind.DIGEST_ROLLUP },
    });
    expect(rollup).toBeNull();
  }, 60_000);
});
