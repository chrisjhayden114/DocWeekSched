/**
 * TRUST-1 — hard-delete EventMembership rows soft-deleted for more than 30 days.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "fs";
import { resolve } from "path";
import dotenv from "dotenv";

for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
  if (existsSync(p)) dotenv.config({ path: p });
}

import { EventMemberRole, EventStatus, OrgRole, PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/auth";
import { MEMBERSHIP_PURGE_AFTER_MS, sweepSoftDeletedMemberships } from "../lib/memberships/purgeSweep";

describe("soft-deleted EventMembership purge (DB)", () => {
  const prisma = new PrismaClient();
  const ids: {
    orgId?: string;
    eventId?: string;
    ownerId?: string;
    activeId?: string;
    recentId?: string;
    staleId?: string;
    recentMembershipId?: string;
    staleMembershipId?: string;
    activeMembershipId?: string;
  } = {};
  const now = new Date("2026-08-18T12:00:00.000Z");

  beforeAll(async () => {
    const passwordHash = await hashPassword("TestPass12!x");
    const stamp = Date.now();

    const owner = await prisma.user.create({
      data: {
        email: `mpurge-owner-${stamp}@example.com`,
        name: "Purge Owner",
        role: "ADMIN",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const active = await prisma.user.create({
      data: {
        email: `mpurge-active-${stamp}@example.com`,
        name: "Purge Active",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const recent = await prisma.user.create({
      data: {
        email: `mpurge-recent-${stamp}@example.com`,
        name: "Purge Recent",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const stale = await prisma.user.create({
      data: {
        email: `mpurge-stale-${stamp}@example.com`,
        name: "Purge Stale",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    ids.ownerId = owner.id;
    ids.activeId = active.id;
    ids.recentId = recent.id;
    ids.staleId = stale.id;

    const org = await prisma.organization.create({
      data: {
        name: `Purge Org ${stamp}`,
        slug: `mpurge-org-${stamp}`,
        plan: "INTERNAL",
        eventAllowance: null,
        memberships: { create: { userId: owner.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;

    const event = await prisma.event.create({
      data: {
        name: `Purge Event ${stamp}`,
        slug: `mpurge-evt-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2027-09-01T14:00:00Z"),
        endDate: new Date("2027-09-03T22:00:00Z"),
        status: EventStatus.ACTIVE,
        organizationId: org.id,
        createdById: owner.id,
      },
    });
    ids.eventId = event.id;

    const activeMem = await prisma.eventMembership.create({
      data: { eventId: event.id, userId: active.id, role: EventMemberRole.ATTENDEE },
    });
    const recentMem = await prisma.eventMembership.create({
      data: {
        eventId: event.id,
        userId: recent.id,
        role: EventMemberRole.ATTENDEE,
        deletedAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
      },
    });
    const staleMem = await prisma.eventMembership.create({
      data: {
        eventId: event.id,
        userId: stale.id,
        role: EventMemberRole.ATTENDEE,
        deletedAt: new Date(now.getTime() - MEMBERSHIP_PURGE_AFTER_MS - 60_000),
      },
    });
    ids.activeMembershipId = activeMem.id;
    ids.recentMembershipId = recentMem.id;
    ids.staleMembershipId = staleMem.id;
  }, 60_000);

  afterAll(async () => {
    if (ids.eventId) {
      await prisma.eventMembership.deleteMany({ where: { eventId: ids.eventId } }).catch(() => null);
      await prisma.event.deleteMany({ where: { id: ids.eventId } }).catch(() => null);
    }
    if (ids.orgId) {
      await prisma.orgMembership.deleteMany({ where: { organizationId: ids.orgId } }).catch(() => null);
      await prisma.organization.delete({ where: { id: ids.orgId } }).catch(() => null);
    }
    for (const id of [ids.ownerId, ids.activeId, ids.recentId, ids.staleId]) {
      if (id) await prisma.user.delete({ where: { id } }).catch(() => null);
    }
    await prisma.$disconnect();
  }, 60_000);

  it("hard-deletes only memberships soft-deleted more than 30 days ago and audits the sweep", async () => {
    const first = await sweepSoftDeletedMemberships(now);
    expect(first.purged).toBe(1);

    expect(await prisma.eventMembership.findUnique({ where: { id: ids.staleMembershipId } })).toBeNull();
    expect(await prisma.eventMembership.findUnique({ where: { id: ids.recentMembershipId } })).not.toBeNull();
    expect(await prisma.eventMembership.findUnique({ where: { id: ids.activeMembershipId } })).not.toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "event_membership", action: "OTHER" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    const payload = (audit?.payload ?? {}) as { sweep?: string; purged?: number };
    expect(payload.sweep).toBe("event_membership_purge");
    expect(payload.purged).toBe(1);

    const second = await sweepSoftDeletedMemberships(now);
    expect(second.purged).toBe(0);
  }, 60_000);
});
