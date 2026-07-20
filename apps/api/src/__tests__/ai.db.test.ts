import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EventMemberRole,
  EventStatus,
  NotificationClass,
  NotificationDelivery,
  OrgRole,
  PrismaClient,
} from "@prisma/client";
import { z } from "zod";
import { hashPassword } from "../lib/auth";
import {
  MockAiProvider,
  resetAiProviderForTests,
  gatewayExtract,
  assertAiCap,
  buildEventGroundingContext,
  assertGroundedIds,
  notifyAgentAttendeeTouch,
  writeAuditLog,
} from "../lib/ai";
import { HttpError } from "../lib/authorization";
import { applyPlanSkuToOrg } from "../lib/billing/entitlements";

describe("AI gateway (DB)", () => {
  const prisma = new PrismaClient();
  const ids: {
    orgId?: string;
    eventId?: string;
    eventBId?: string;
    userId?: string;
    sessionId?: string;
  } = {};
  let dbReady = false;

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await prisma.aiUsageRecord.findFirst();
    } catch {
      console.warn("[ai.db.test] DB unreachable or A0 tables missing — skipping");
      return;
    }
    dbReady = true;
    process.env.AI_PROVIDER = "mock";
    resetAiProviderForTests(new MockAiProvider());

    const passwordHash = await hashPassword("TestPass12!x");
    const stamp = Date.now();
    const user = await prisma.user.create({
      data: {
        email: `ai-a0-${stamp}@example.com`,
        name: "AI Tester",
        passwordHash,
        role: "ATTENDEE",
      },
    });
    ids.userId = user.id;

    const org = await prisma.organization.create({
      data: {
        name: `AI Org ${stamp}`,
        slug: `ai-org-${stamp}`,
        plan: "FREE",
        eventAllowance: 2,
        memberships: { create: { userId: user.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;
    await applyPlanSkuToOrg(org.id, "free");

    const event = await prisma.event.create({
      data: {
        name: `AI Event ${stamp}`,
        slug: `ai-event-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2027-06-01T14:00:00Z"),
        endDate: new Date("2027-06-03T22:00:00Z"),
        status: EventStatus.ACTIVE,
        organizationId: org.id,
        createdById: user.id,
        memberships: { create: { userId: user.id, role: EventMemberRole.ADMIN } },
      },
    });
    ids.eventId = event.id;

    const eventB = await prisma.event.create({
      data: {
        name: `AI Event B ${stamp}`,
        slug: `ai-event-b-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2027-07-01T14:00:00Z"),
        endDate: new Date("2027-07-03T22:00:00Z"),
        status: EventStatus.ACTIVE,
        organizationId: org.id,
        createdById: user.id,
      },
    });
    ids.eventBId = eventB.id;

    const session = await prisma.session.create({
      data: {
        eventId: event.id,
        title: "Grounded session",
        startsAt: new Date("2027-06-01T15:00:00Z"),
        endsAt: new Date("2027-06-01T16:00:00Z"),
      },
    });
    ids.sessionId = session.id;
  });

  afterAll(async () => {
    if (ids.eventId) {
      await prisma.aiUsageRecord.deleteMany({ where: { eventId: ids.eventId } }).catch(() => null);
      await prisma.auditLog.deleteMany({ where: { eventId: ids.eventId } }).catch(() => null);
      await prisma.userNotification.deleteMany({ where: { eventId: ids.eventId } }).catch(() => null);
      await prisma.session.deleteMany({ where: { eventId: ids.eventId } }).catch(() => null);
      await prisma.eventMembership.deleteMany({ where: { eventId: ids.eventId } }).catch(() => null);
      await prisma.event.delete({ where: { id: ids.eventId } }).catch(() => null);
    }
    if (ids.eventBId) {
      await prisma.event.delete({ where: { id: ids.eventBId } }).catch(() => null);
    }
    if (ids.orgId) {
      await prisma.aiUsageRecord.deleteMany({ where: { organizationId: ids.orgId } }).catch(() => null);
      await prisma.auditLog.deleteMany({ where: { organizationId: ids.orgId } }).catch(() => null);
      await prisma.orgMembership.deleteMany({ where: { organizationId: ids.orgId } }).catch(() => null);
      await prisma.organization.delete({ where: { id: ids.orgId } }).catch(() => null);
    }
    if (ids.userId) await prisma.user.delete({ where: { id: ids.userId } }).catch(() => null);
    await prisma.$disconnect();
  });

  it("enforces FREE ingest cap (2nd call → PLAN_LIMIT)", async () => {
    if (!dbReady) return;
    resetAiProviderForTests(new MockAiProvider());
    const schema = z.object({ ok: z.boolean() });
    const mock = new MockAiProvider();
    mock.chat = async () => ({
      text: JSON.stringify({ ok: true }),
      tokensIn: 5,
      tokensOut: 3,
      model: "mock-extract-v1",
      provider: "mock",
    });
    resetAiProviderForTests(mock);

    await prisma.aiUsageRecord.deleteMany({
      where: { organizationId: ids.orgId!, eventId: ids.eventId!, feature: "AGENDA_INGEST" },
    });

    const first = await gatewayExtract(schema, [{ role: "user", content: "__MOCK_JSON__:{\"ok\":true}" }], {
      organizationId: ids.orgId!,
      eventId: ids.eventId!,
      userId: ids.userId!,
      feature: "AGENDA_INGEST",
    });
    expect(first.ok).toBe(true);

    await expect(assertAiCap(ids.orgId!, ids.eventId!, "AGENDA_INGEST")).rejects.toBeInstanceOf(HttpError);
    try {
      await assertAiCap(ids.orgId!, ids.eventId!, "AGENDA_INGEST");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      const body = (err as HttpError).body as { upgrade?: { code?: string } };
      expect(body.upgrade?.code).toBe("PLAN_LIMIT");
    }

    const second = await gatewayExtract(schema, [{ role: "user", content: "__MOCK_JSON__:{\"ok\":true}" }], {
      organizationId: ids.orgId!,
      eventId: ids.eventId!,
      userId: ids.userId!,
      feature: "AGENDA_INGEST",
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.code).toBe("CAP_EXCEEDED");
      expect((second.upgrade as { code?: string })?.code).toBe("PLAN_LIMIT");
    }
  });

  it("writes audit entries on extract", async () => {
    if (!dbReady) return;
    const mock = new MockAiProvider();
    mock.chat = async () => ({
      text: JSON.stringify({ name: "x" }),
      tokensIn: 2,
      tokensOut: 2,
      model: "mock-extract-v1",
      provider: "mock",
    });
    resetAiProviderForTests(mock);

    const before = await prisma.auditLog.count({
      where: { organizationId: ids.orgId!, action: "AI_EXTRACT", aiGenerated: true },
    });
    await gatewayExtract(z.object({ name: z.string() }), [{ role: "user", content: "x" }], {
      organizationId: ids.orgId!,
      eventId: ids.eventBId!,
      userId: ids.userId!,
      feature: "OTHER",
      skipCap: true,
    });
    const after = await prisma.auditLog.count({
      where: { organizationId: ids.orgId!, action: "AI_EXTRACT", aiGenerated: true },
    });
    expect(after).toBeGreaterThan(before);
  });

  it("grounding builder rejects cross-event session IDs", async () => {
    if (!dbReady) return;
    const grounding = await buildEventGroundingContext(ids.eventId!);
    expect(grounding.sessionIds.has(ids.sessionId!)).toBe(true);
    expect(() => assertGroundedIds(grounding, { sessionIds: [ids.sessionId!] })).not.toThrow();
    expect(() => assertGroundedIds(grounding, { eventId: ids.eventBId! })).toThrow(/Foreign eventId/);
    expect(() => assertGroundedIds(grounding, { sessionIds: ["clforeign0000000000000001"] })).toThrow(
      /Foreign sessionId/,
    );
  });

  it("notifyAgentAttendeeTouch is DIGEST and never PUSHED", async () => {
    if (!dbReady) return;
    const result = await notifyAgentAttendeeTouch({
      userId: ids.userId!,
      eventId: ids.eventId!,
      title: "Suggested meetup",
      body: "Based on your interests",
    });
    expect(result.class).toBe(NotificationClass.DIGEST);
    expect(result.delivery).not.toBe(NotificationDelivery.PUSHED);
    expect(result.delivery).not.toBe(NotificationDelivery.QUEUED_PUSH);

    const row = await prisma.userNotification.findUnique({ where: { id: result.notificationId } });
    expect(row?.kind).toBe("AGENT_ATTENDEE_TOUCH");
    expect(row?.class).toBe(NotificationClass.DIGEST);
    expect(row?.budgetCharged).toBe(false);
  });

  it("writeAuditLog stores aiGenerated drafts", async () => {
    if (!dbReady) return;
    const { id } = await writeAuditLog({
      organizationId: ids.orgId!,
      eventId: ids.eventId!,
      actorUserId: ids.userId!,
      action: "AI_DRAFT",
      entityType: "draft",
      aiGenerated: true,
      payload: { note: "test" },
    });
    const row = await prisma.auditLog.findUnique({ where: { id } });
    expect(row?.aiGenerated).toBe(true);
  });
});
