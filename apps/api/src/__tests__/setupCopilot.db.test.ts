import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OrgRole, PrismaClient, SessionPublishStatus } from "@prisma/client";
import { applyPreset, emptySetupFormState } from "@event-app/shared";
import { hashPassword } from "../lib/auth";
import { MockAiProvider, resetAiProviderForTests } from "../lib/ai";
import { completeSetupCopilot } from "../lib/ai/setupCopilot/complete";
import { applyConfigureFeatures } from "../lib/ai/setupCopilot/features";
import {
  buildConfigDiffCard,
  parseFeatureRequests,
  assertRegistryKeys,
  UnknownFeatureKeyError,
} from "../lib/ai/setupCopilot";
import { loadFeatureOverrides } from "../lib/features";
import { applyPlanSkuToOrg } from "../lib/billing/entitlements";

describe("Setup Copilot A2 (DB)", () => {
  const prisma = new PrismaClient();
  const ids: { orgId?: string; userId?: string; eventIds: string[]; seriesIds: string[] } = {
    eventIds: [],
    seriesIds: [],
  };
  let dbReady = false;

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await prisma.aiUsageRecord.findFirst();
      await prisma.eventFeatureConfig.findFirst();
    } catch {
      console.warn("[setupCopilot.db.test] DB unreachable or A0/2.6 tables missing — skipping");
      return;
    }
    dbReady = true;
    process.env.AI_PROVIDER = "mock";
    resetAiProviderForTests(new MockAiProvider());

    const stamp = Date.now();
    const passwordHash = await hashPassword("TestPass12!x");
    const user = await prisma.user.create({
      data: {
        email: `a2-${stamp}@example.com`,
        name: "A2 Tester",
        passwordHash,
        role: "ADMIN",
      },
    });
    ids.userId = user.id;

    const org = await prisma.organization.create({
      data: {
        name: `A2 Org ${stamp}`,
        slug: `a2-org-${stamp}`,
        plan: "PRO",
        eventAllowance: 20,
        memberships: { create: { userId: user.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;
    await applyPlanSkuToOrg(org.id, "pro_annual");
  });

  afterAll(async () => {
    if (!dbReady) {
      await prisma.$disconnect().catch(() => undefined);
      return;
    }
    for (const eventId of ids.eventIds) {
      await prisma.networkThread.deleteMany({ where: { eventId } });
      await prisma.announcement.deleteMany({ where: { eventId } });
      await prisma.session.deleteMany({ where: { eventId } });
      await prisma.track.deleteMany({ where: { eventId } });
      await prisma.eventFeatureConfig.deleteMany({ where: { eventId } });
      await prisma.auditLog.deleteMany({ where: { eventId } });
      await prisma.aiUsageRecord.deleteMany({ where: { eventId } });
      await prisma.eventMembership.deleteMany({ where: { eventId } });
      await prisma.event.deleteMany({ where: { id: eventId } });
    }
    for (const seriesId of ids.seriesIds) {
      await prisma.eventSeries.deleteMany({ where: { id: seriesId } });
    }
    if (ids.orgId) {
      await prisma.auditLog.deleteMany({ where: { organizationId: ids.orgId } });
      await prisma.aiUsageRecord.deleteMany({ where: { organizationId: ids.orgId } });
      await prisma.orgMembership.deleteMany({ where: { organizationId: ids.orgId } });
      await prisma.organization.deleteMany({ where: { id: ids.orgId } });
    }
    if (ids.userId) await prisma.user.deleteMany({ where: { id: ids.userId } });
    await prisma.$disconnect();
  });

  it("complete creates draft event + DRAFT sessions matching answers; checklist marks create+sessions", async () => {
    if (!dbReady) return;
    const form = {
      ...emptySetupFormState("America/New_York"),
      name: `A2 Summit ${Date.now()}`,
      startDate: "2027-09-10",
      endDate: "2027-09-11",
      timezone: "America/New_York",
      venueName: "Hall A",
      estimatedSize: "120",
      eventType: "conference" as const,
      hasProgramDocument: false,
      networkingChoice: "full" as const,
      featureOverrides: applyPreset("everything"),
      suggestedPreset: "everything" as const,
    };

    const result = await completeSetupCopilot({
      organizationId: ids.orgId!,
      actorUserId: ids.userId!,
      form,
      webBaseUrl: "http://localhost:3000",
    });
    ids.eventIds.push(result.eventId);

    const event = await prisma.event.findUniqueOrThrow({ where: { id: result.eventId } });
    ids.seriesIds.push(event.seriesId!);
    expect(event.name).toBe(form.name);
    expect(event.venueName).toBe("Hall A");
    expect(result.aiGenerated).toBe(true);
    expect(result.sessionIds.length).toBeGreaterThan(0);

    const sessions = await prisma.session.findMany({ where: { eventId: result.eventId } });
    expect(sessions.every((s) => s.publishStatus === SessionPublishStatus.DRAFT)).toBe(true);

    const checklist = result.checklist;
    expect(checklist.find((c) => c.key === "create_event")?.done).toBe(true);
    expect(checklist.find((c) => c.key === "add_sessions")?.done).toBe(true);

    const ice = await prisma.networkThread.count({
      where: { eventId: result.eventId, channel: "ICEBREAKER" },
    });
    expect(ice).toBe(2);

    const audit = await prisma.auditLog.findFirst({
      where: { eventId: result.eventId, action: "AI_DRAFT", entityType: "setup_copilot_complete" },
    });
    expect(audit?.aiGenerated).toBe(true);
  });

  it("confirm-gated configureFeatures applies only on confirm and audits", async () => {
    if (!dbReady) return;
    const form = {
      ...emptySetupFormState("UTC"),
      name: `A2 Features ${Date.now()}`,
      startDate: "2027-10-01",
      endDate: "2027-10-01",
      timezone: "UTC",
      eventType: "meetup" as const,
      hasProgramDocument: false,
      featureOverrides: applyPreset("everything"),
      networkingChoice: "full" as const,
      suggestedPreset: "everything" as const,
    };
    const created = await completeSetupCopilot({
      organizationId: ids.orgId!,
      actorUserId: ids.userId!,
      form,
      webBaseUrl: "http://localhost:3000",
    });
    ids.eventIds.push(created.eventId);
    const ev = await prisma.event.findUniqueOrThrow({ where: { id: created.eventId } });
    if (ev.seriesId) ids.seriesIds.push(ev.seriesId);

    const parsed = parseFeatureRequests(
      "no ice-breakers, and everyone's local so don't show timezone conversion",
    );
    const before = await loadFeatureOverrides(created.eventId);
    const card = buildConfigDiffCard({
      current: before,
      patch: parsed.patch,
      requestedKeys: parsed.requestedKeys,
      liveEvent: false,
    });
    expect(before.community_icebreakers).not.toBe(false);

    const applied = await applyConfigureFeatures({
      eventId: created.eventId,
      organizationId: ids.orgId!,
      actorUserId: ids.userId!,
      overrides: card.proposedOverrides,
      diffSummary: card.summary,
    });
    expect(applied.aiGenerated).toBe(true);
    expect(applied.overrides.community_icebreakers).toBe(false);
    expect(applied.overrides.timezone_toggle).toBe(false);

    const toolAudit = await prisma.auditLog.findFirst({
      where: {
        eventId: created.eventId,
        action: "AI_TOOL",
        entityType: "event_feature_config",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(toolAudit?.aiGenerated).toBe(true);
    const payload = toolAudit?.payload as { tool?: string };
    expect(payload?.tool).toBe("configureFeatures");
  });

  it("rejects unknown registry keys", () => {
    if (!dbReady) return;
    expect(() => assertRegistryKeys({ totally_fake_key: true })).toThrow(UnknownFeatureKeyError);
  });
});
