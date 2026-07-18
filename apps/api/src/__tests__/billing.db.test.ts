import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EventMemberRole, EventStatus, OrgRole, PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/auth";
import { HttpError } from "../lib/authorization";
import { newJoinToken } from "../lib/inviteTokens";
import {
  applyPlanSkuToOrg,
  assertCanAddAttendee,
  assertCanCreateEvent,
  can,
  limit,
  markPaymentFailed,
  processVerifiedWebhook,
  signMockWebhook,
  mockSubscriptionPayload,
  MockBillingProvider,
  GRACE_PERIOD_DAYS,
} from "../lib/billing";
import { featureEnabled } from "../lib/features";

describe("billing entitlements (DB)", () => {
  const prisma = new PrismaClient();
  const ids: {
    orgId?: string;
    eventId?: string;
    userId?: string;
  } = {};
  let dbReady = false;

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await prisma.billingWebhookEvent.findFirst();
    } catch {
      console.warn("[billing.db.test] DB unreachable or Phase 3 tables missing — skipping");
      return;
    }
    dbReady = true;

    const passwordHash = await hashPassword("TestPass12!x");
    const user = await prisma.user.create({
      data: {
        email: `bill-${Date.now()}@example.com`,
        name: "Billing Tester",
        role: "ADMIN",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    ids.userId = user.id;

    const org = await prisma.organization.create({
      data: {
        name: "Billing Org",
        slug: `bill-org-${Date.now()}`,
        plan: "FREE",
        eventAllowance: 1,
        memberships: { create: { userId: user.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;

    const { hash } = newJoinToken();
    const event = await prisma.event.create({
      data: {
        name: "Billing Event",
        slug: `bill-evt-${Date.now()}`,
        timezone: "UTC",
        startDate: new Date("2026-12-01T14:00:00Z"),
        endDate: new Date("2026-12-03T22:00:00Z"),
        status: EventStatus.ACTIVE,
        organizationId: org.id,
        createdById: user.id,
        joinTokenHash: hash,
        attendeeCap: 50,
        memberships: { create: { userId: user.id, role: EventMemberRole.ADMIN } },
      },
    });
    ids.eventId = event.id;
  });

  afterAll(async () => {
    if (!dbReady) {
      await prisma.$disconnect().catch(() => undefined);
      return;
    }
    if (ids.eventId) {
      await prisma.eventMembership.deleteMany({ where: { eventId: ids.eventId } });
      await prisma.eventFeatureConfig.deleteMany({ where: { eventId: ids.eventId } });
      await prisma.eventPurchase.deleteMany({ where: { eventId: ids.eventId } });
      await prisma.event.deleteMany({ where: { id: ids.eventId } });
    }
    if (ids.orgId) {
      await prisma.billingWebhookEvent.deleteMany({});
      await prisma.eventPurchase.deleteMany({ where: { organizationId: ids.orgId } });
      await prisma.orgMembership.deleteMany({ where: { organizationId: ids.orgId } });
      await prisma.organization.deleteMany({ where: { id: ids.orgId } });
    }
    if (ids.userId) await prisma.user.deleteMany({ where: { id: ids.userId } });
    await prisma.$disconnect();
  });

  it("FREE can() allows community, blocks analytics; limit attendees = 50", async () => {
    if (!dbReady) return;
    await applyPlanSkuToOrg(ids.orgId!, "free");
    expect(await can(ids.orgId!, "community")).toBe(true);
    expect(await can(ids.orgId!, "analytics")).toBe(false);
    expect(await limit(ids.orgId!, "attendees")).toBe(50);
    expect(await limit(ids.orgId!, "activeEvents")).toBe(1);
  });

  it("NULL eventAllowance means unlimited active events", async () => {
    if (!dbReady) return;
    await prisma.organization.update({
      where: { id: ids.orgId! },
      data: { plan: "PRO", eventAllowance: null, subscriptionStatus: "ACTIVE" },
    });
    expect(await limit(ids.orgId!, "activeEvents")).toBeNull();
    await assertCanCreateEvent(ids.orgId!);
  });

  it("FREE→PRO upgrade via signed subscription webhook", async () => {
    if (!dbReady) return;
    await applyPlanSkuToOrg(ids.orgId!, "free");
    const body = mockSubscriptionPayload("subscription_created", {
      orgId: ids.orgId!,
      planKey: "pro_annual",
      customerId: "cust_test_1",
      subscriptionId: "sub_test_1",
      externalEventId: `evt_upgrade_${Date.now()}`,
    });
    const { raw, signature } = signMockWebhook(body);
    const verified = new MockBillingProvider().verifyWebhook(raw, signature);
    const first = await processVerifiedWebhook(verified);
    expect(first.duplicate).toBe(false);
    expect(await can(ids.orgId!, "analytics")).toBe(true);
    expect(await limit(ids.orgId!, "activeEvents")).toBeNull();

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: ids.orgId! } });
    expect(org.plan).toBe("PRO");
    expect(org.subscriptionStatus).toBe("ACTIVE");

    // Idempotent replay
    const second = await processVerifiedWebhook(verified);
    expect(second.duplicate).toBe(true);
  });

  it("featureEnabled ANDs plan entitlement", async () => {
    if (!dbReady) return;
    await applyPlanSkuToOrg(ids.orgId!, "free");
    // engagement_points is off on FREE plan entitlements
    expect(await featureEnabled(ids.eventId!, "engagement_points")).toBe(false);
    await applyPlanSkuToOrg(ids.orgId!, "pro_monthly");
    expect(await featureEnabled(ids.eventId!, "engagement_points")).toBe(true);
  });

  it("assertCanCreateEvent 402 when FREE already has an active event", async () => {
    if (!dbReady) return;
    await applyPlanSkuToOrg(ids.orgId!, "free");
    await expect(assertCanCreateEvent(ids.orgId!)).rejects.toMatchObject({ status: 402 });
  });

  it("assertCanAddAttendee 402 at cap", async () => {
    if (!dbReady) return;
    await applyPlanSkuToOrg(ids.orgId!, "free");
    await prisma.event.update({ where: { id: ids.eventId! }, data: { attendeeCap: 1 } });
    // Already 1 membership (admin) → next add fails
    await expect(assertCanAddAttendee(ids.eventId!)).rejects.toBeInstanceOf(HttpError);
    await expect(assertCanAddAttendee(ids.eventId!)).rejects.toMatchObject({ status: 402 });
    await prisma.event.update({ where: { id: ids.eventId! }, data: { attendeeCap: 50 } });
  });

  it("payment-failed grace then read-only blocks writes", async () => {
    if (!dbReady) return;
    await applyPlanSkuToOrg(ids.orgId!, "pro_monthly", { subscriptionStatus: "ACTIVE", clearGrace: true });
    const ends = await markPaymentFailed(ids.orgId!);
    expect(ends.getTime()).toBeGreaterThan(Date.now());

    // Still writable during grace
    await prisma.organization.update({
      where: { id: ids.orgId! },
      data: { eventAllowance: null },
    });
    await assertCanCreateEvent(ids.orgId!);

    // Expire grace
    await prisma.organization.update({
      where: { id: ids.orgId! },
      data: {
        subscriptionStatus: "PAST_DUE",
        gracePeriodEndsAt: new Date(Date.now() - 1000),
      },
    });
    await expect(assertCanCreateEvent(ids.orgId!)).rejects.toMatchObject({ status: 403 });

    // payment success webhook clears grace
    const body = mockSubscriptionPayload("subscription_payment_success", {
      orgId: ids.orgId!,
      planKey: "pro_monthly",
      externalEventId: `evt_grace_clear_${Date.now()}`,
    });
    const { raw, signature } = signMockWebhook(body);
    await processVerifiedWebhook(new MockBillingProvider().verifyWebhook(raw, signature));
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: ids.orgId! } });
    expect(org.subscriptionStatus).toBe("ACTIVE");
    expect(org.gracePeriodEndsAt).toBeNull();
  });

  it("GRACE_PERIOD_DAYS is 7", () => {
    expect(GRACE_PERIOD_DAYS).toBe(7);
  });
});
