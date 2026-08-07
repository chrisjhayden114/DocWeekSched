import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EventMemberRole, OrgRole, PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/auth";
import { HttpError } from "../lib/authorization";
import { newJoinToken } from "../lib/inviteTokens";
import {
  buildFeatureState,
  featureEnabled,
  loadFeatureOverrides,
  requireFeature,
  upsertFeatureOverrides,
} from "../lib/features";

/**
 * ER1 — readiness stays 404 for every org without the plan entitlement,
 * even with an explicit override, and only turns on for an INTERNAL org
 * that also enabled it. No schema was added in this phase; these tests
 * exercise only the existing feature/entitlement tables.
 */
describe("readiness feature gate (DB, ER1)", () => {
  const prisma = new PrismaClient();
  const ids: { orgId?: string; eventId?: string; userId?: string } = {};

  beforeAll(async () => {
    const passwordHash = await hashPassword("TestPass12!x");
    const user = await prisma.user.create({
      data: {
        email: `readiness-${Date.now()}@example.com`,
        name: "Readiness Tester",
        role: "ADMIN",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    ids.userId = user.id;

    const org = await prisma.organization.create({
      data: {
        name: "Readiness Org",
        slug: `readiness-org-${Date.now()}`,
        memberships: { create: { userId: user.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;

    const { hash } = newJoinToken();
    const event = await prisma.event.create({
      data: {
        name: "Readiness Conf",
        slug: `readiness-conf-${Date.now()}`,
        timezone: "UTC",
        startDate: new Date("2026-11-01T14:00:00Z"),
        endDate: new Date("2026-11-03T22:00:00Z"),
        organizationId: org.id,
        createdById: user.id,
        joinTokenHash: hash,
        memberships: { create: { userId: user.id, role: EventMemberRole.ADMIN } },
      },
    });
    ids.eventId = event.id;
  });

  afterAll(async () => {
    if (ids.eventId) {
      await prisma.eventFeatureConfig.deleteMany({ where: { eventId: ids.eventId } });
      await prisma.eventMembership.deleteMany({ where: { eventId: ids.eventId } });
      await prisma.event.deleteMany({ where: { id: ids.eventId } });
    }
    if (ids.orgId) {
      await prisma.orgMembership.deleteMany({ where: { organizationId: ids.orgId } });
      await prisma.organization.deleteMany({ where: { id: ids.orgId } });
    }
    if (ids.userId) await prisma.user.deleteMany({ where: { id: ids.userId } });
    await prisma.$disconnect();
  });

  it("is off by default and requireFeature 404s (default FREE plan)", async () => {
    expect(await featureEnabled(ids.eventId!, "readiness")).toBe(false);
    await expect(requireFeature(ids.eventId!, "readiness")).rejects.toMatchObject({
      status: 404,
    } satisfies Partial<HttpError>);
  });

  it("stays 404 even with an explicit organizer override when the plan disallows it", async () => {
    await upsertFeatureOverrides(ids.eventId!, { readiness: true });
    expect(await featureEnabled(ids.eventId!, "readiness")).toBe(false);
    await expect(requireFeature(ids.eventId!, "readiness")).rejects.toMatchObject({ status: 404 });
  });

  it("is reported organizer-invisible in the features payload", async () => {
    const overrides = await loadFeatureOverrides(ids.eventId!);
    const rows = await buildFeatureState(overrides, ids.orgId);
    const row = rows.find((r) => r.key === "readiness");
    expect(row).toBeDefined();
    expect(row!.organizerVisible).toBe(false);
    expect(row!.enabled).toBe(false);
  });

  it("turns on only for an INTERNAL org that also enabled it (pilot gate)", async () => {
    await prisma.organization.update({ where: { id: ids.orgId! }, data: { plan: "INTERNAL" } });

    // Entitled but override cleared: defaultOn false keeps it off.
    await upsertFeatureOverrides(ids.eventId!, { readiness: false });
    expect(await featureEnabled(ids.eventId!, "readiness")).toBe(false);

    // Entitled AND enabled: on.
    await upsertFeatureOverrides(ids.eventId!, { readiness: true });
    expect(await featureEnabled(ids.eventId!, "readiness")).toBe(true);
    await expect(requireFeature(ids.eventId!, "readiness")).resolves.toBeUndefined();

    // Back to FREE: entitlement loss shuts it off with no data changes.
    await prisma.organization.update({ where: { id: ids.orgId! }, data: { plan: "FREE" } });
    expect(await featureEnabled(ids.eventId!, "readiness")).toBe(false);
  });
});
