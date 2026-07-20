import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EventMemberRole, NetworkChannel, OrgRole, PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/auth";
import { HttpError } from "../lib/authorization";
import { newJoinToken } from "../lib/inviteTokens";
import {
  featureEnabled,
  requireFeature,
  upsertFeatureOverrides,
} from "../lib/features";

describe("feature gates (DB)", () => {
  const prisma = new PrismaClient();
  const ids: {
    orgId?: string;
    eventId?: string;
    userId?: string;
    threadId?: string;
  } = {};
  let dbReady = false;

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      // Probe that Phase 2.6 table exists (migration applied).
      await prisma.eventFeatureConfig.findFirst();
    } catch {
      console.warn("[features.db.test] DATABASE_URL unreachable or EventFeatureConfig missing — skipping");
      return;
    }
    dbReady = true;

    const passwordHash = await hashPassword("TestPass12!x");
    const user = await prisma.user.create({
      data: {
        email: `feat-${Date.now()}@example.com`,
        name: "Feature Tester",
        role: "ADMIN",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    ids.userId = user.id;

    const org = await prisma.organization.create({
      data: {
        name: "Feature Org",
        slug: `feat-org-${Date.now()}`,
        memberships: { create: { userId: user.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;

    const { hash } = newJoinToken();
    const event = await prisma.event.create({
      data: {
        name: "Feature Conf",
        slug: `feat-conf-${Date.now()}`,
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

    const thread = await prisma.networkThread.create({
      data: {
        eventId: event.id,
        authorId: user.id,
        title: "Icebreaker intro",
        body: "Hello everyone",
        channel: NetworkChannel.ICEBREAKER,
      },
    });
    ids.threadId = thread.id;
  });

  afterAll(async () => {
    if (!dbReady) {
      await prisma.$disconnect().catch(() => undefined);
      return;
    }
    if (ids.threadId) await prisma.networkThread.deleteMany({ where: { id: ids.threadId } });
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

  it("defaults community on before any config row", async () => {
    if (!dbReady) return;
    expect(await featureEnabled(ids.eventId!, "community")).toBe(true);
    expect(await featureEnabled(ids.eventId!, "community_icebreakers")).toBe(true);
  });

  it("requireFeature throws 404 when a feature is disabled", async () => {
    if (!dbReady) return;
    await upsertFeatureOverrides(ids.eventId!, { community_icebreakers: false });
    await expect(requireFeature(ids.eventId!, "community_icebreakers")).rejects.toMatchObject({
      status: 404,
    } satisfies Partial<HttpError>);
    await expect(requireFeature(ids.eventId!, "community")).resolves.toBeUndefined();
  });

  it("community-off cascades to icebreakers for requireFeature", async () => {
    if (!dbReady) return;
    await upsertFeatureOverrides(ids.eventId!, {
      community: false,
      community_icebreakers: true,
    });
    await expect(requireFeature(ids.eventId!, "community")).rejects.toMatchObject({ status: 404 });
    await expect(requireFeature(ids.eventId!, "community_icebreakers")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("preserves network threads across community off/on", async () => {
    if (!dbReady) return;
    await upsertFeatureOverrides(ids.eventId!, { community: false });
    expect(await featureEnabled(ids.eventId!, "community")).toBe(false);

    const whileOff = await prisma.networkThread.findUnique({ where: { id: ids.threadId! } });
    expect(whileOff?.title).toBe("Icebreaker intro");
    expect(whileOff?.body).toBe("Hello everyone");

    await upsertFeatureOverrides(ids.eventId!, { community: true, community_icebreakers: true });
    expect(await featureEnabled(ids.eventId!, "community")).toBe(true);
    expect(await featureEnabled(ids.eventId!, "community_icebreakers")).toBe(true);

    const whileOn = await prisma.networkThread.findUnique({ where: { id: ids.threadId! } });
    expect(whileOn?.id).toBe(ids.threadId);
    expect(whileOn?.title).toBe("Icebreaker intro");
  });
});
