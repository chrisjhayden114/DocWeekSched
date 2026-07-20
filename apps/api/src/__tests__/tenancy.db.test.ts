import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EventMemberRole, OrgRole, PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/auth";
import { HttpError, requireEventAccess, requireOrgRole } from "../lib/authorization";
import { newJoinToken, isJoinLinkActive } from "../lib/inviteTokens";
import { allAttendeeUserIds } from "../lib/notifications";

describe("tenancy isolation (DB)", () => {
  const prisma = new PrismaClient();
  const ids: {
    orgA?: string;
    orgB?: string;
    eventA?: string;
    eventB?: string;
    ownerA?: string;
    adminB?: string;
    attendeeA?: string;
  } = {};
  let dbReady = false;

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReady = true;
    } catch {
      console.warn("[tenancy.db.test] DATABASE_URL unreachable — skipping DB tests");
      return;
    }

    const passwordHash = await hashPassword("TestPass12!x");
    const ownerA = await prisma.user.create({
      data: {
        email: `owner-a-${Date.now()}@example.com`,
        name: "Owner A",
        role: "ADMIN",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const adminB = await prisma.user.create({
      data: {
        email: `admin-b-${Date.now()}@example.com`,
        name: "Admin B",
        role: "ADMIN",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const attendeeA = await prisma.user.create({
      data: {
        email: `attendee-a-${Date.now()}@example.com`,
        name: "Attendee A",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    ids.ownerA = ownerA.id;
    ids.adminB = adminB.id;
    ids.attendeeA = attendeeA.id;

    const orgA = await prisma.organization.create({
      data: {
        name: "Org A",
        slug: `org-a-${Date.now()}`,
        memberships: { create: { userId: ownerA.id, role: OrgRole.OWNER } },
      },
    });
    const orgB = await prisma.organization.create({
      data: {
        name: "Org B",
        slug: `org-b-${Date.now()}`,
        memberships: { create: { userId: adminB.id, role: OrgRole.ADMIN } },
      },
    });
    ids.orgA = orgA.id;
    ids.orgB = orgB.id;

    const { hash: joinHashA } = newJoinToken();
    const { hash: joinHashB } = newJoinToken();

    const eventA = await prisma.event.create({
      data: {
        name: "Event A",
        slug: `event-a-${Date.now()}`,
        timezone: "UTC",
        startDate: new Date(),
        endDate: new Date(),
        organizationId: orgA.id,
        createdById: ownerA.id,
        joinTokenHash: joinHashA,
        memberships: {
          create: [
            { userId: ownerA.id, role: EventMemberRole.ADMIN },
            { userId: attendeeA.id, role: EventMemberRole.ATTENDEE },
          ],
        },
      },
    });
    const eventB = await prisma.event.create({
      data: {
        name: "Event B",
        slug: `event-b-${Date.now()}`,
        timezone: "UTC",
        startDate: new Date(),
        endDate: new Date(),
        organizationId: orgB.id,
        createdById: adminB.id,
        joinTokenHash: joinHashB,
        memberships: {
          create: [{ userId: adminB.id, role: EventMemberRole.ADMIN }],
        },
      },
    });
    ids.eventA = eventA.id;
    ids.eventB = eventB.id;
  });

  afterAll(async () => {
    if (!dbReady) {
      await prisma.$disconnect().catch(() => undefined);
      return;
    }
    if (ids.eventA) await prisma.eventMembership.deleteMany({ where: { eventId: ids.eventA } });
    if (ids.eventB) await prisma.eventMembership.deleteMany({ where: { eventId: ids.eventB } });
    if (ids.eventA) await prisma.event.deleteMany({ where: { id: ids.eventA } });
    if (ids.eventB) await prisma.event.deleteMany({ where: { id: ids.eventB } });
    if (ids.orgA) await prisma.orgMembership.deleteMany({ where: { organizationId: ids.orgA } });
    if (ids.orgB) await prisma.orgMembership.deleteMany({ where: { organizationId: ids.orgB } });
    if (ids.orgA) await prisma.organization.deleteMany({ where: { id: ids.orgA } });
    if (ids.orgB) await prisma.organization.deleteMany({ where: { id: ids.orgB } });
    const userIds = [ids.ownerA, ids.adminB, ids.attendeeA].filter(Boolean) as string[];
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("blocks org B admin from managing org A event", async () => {
    if (!dbReady) return;
    await expect(requireEventAccess(ids.adminB!, ids.eventA!, { manage: true })).rejects.toBeInstanceOf(HttpError);
  });

  it("allows org A owner to manage event A", async () => {
    if (!dbReady) return;
    const access = await requireEventAccess(ids.ownerA!, ids.eventA!, { manage: true });
    expect(access.canManageEvent).toBe(true);
  });

  it("allows attendee read but not manage", async () => {
    if (!dbReady) return;
    const access = await requireEventAccess(ids.attendeeA!, ids.eventA!);
    expect(access.canManageEvent).toBe(false);
    await expect(requireEventAccess(ids.attendeeA!, ids.eventA!, { manage: true })).rejects.toBeInstanceOf(HttpError);
  });

  it("OWNER-only gate rejects org ADMIN", async () => {
    if (!dbReady) return;
    await expect(requireOrgRole(ids.adminB!, ids.orgB!, OrgRole.OWNER)).rejects.toBeInstanceOf(HttpError);
    const owner = await requireOrgRole(ids.ownerA!, ids.orgA!, OrgRole.OWNER);
    expect(owner.membershipRole).toBe(OrgRole.OWNER);
  });

  it("notification fan-out is scoped to event membership", async () => {
    if (!dbReady) return;
    const idsA = await allAttendeeUserIds(ids.eventA!);
    expect(idsA.sort()).toEqual([ids.ownerA!, ids.attendeeA!].sort());
    expect(idsA).not.toContain(ids.adminB!);
  });

  it("revoked join token is inactive", async () => {
    if (!dbReady) return;
    await prisma.event.update({
      where: { id: ids.eventA! },
      data: { joinTokenRevokedAt: new Date() },
    });
    const event = await prisma.event.findUniqueOrThrow({ where: { id: ids.eventA! } });
    expect(isJoinLinkActive(event)).toBe(false);
  });
});
