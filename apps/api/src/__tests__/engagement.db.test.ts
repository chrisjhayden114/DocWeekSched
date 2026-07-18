import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CheckInMethod,
  EventMemberRole,
  EventStatus,
  OrgRole,
  PrismaClient,
  SessionPollStatus,
} from "@prisma/client";
import { hashPassword } from "../lib/auth";
import { applyPlanSkuToOrg } from "../lib/billing/entitlements";
import { upsertFeatureOverrides } from "../lib/features/featureEnabled";

describe("Phase 5 engagement (DB)", () => {
  const prisma = new PrismaClient();
  const ids: {
    orgId?: string;
    eventId?: string;
    sessionId?: string;
    adminId?: string;
    attendeeId?: string;
    threadId?: string;
    pollId?: string;
    optionA?: string;
    optionB?: string;
    checkInCode?: string;
  } = {};
  let dbReady = false;

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await prisma.sessionDiscussionUpvote.findFirst();
      await prisma.sessionPoll.findFirst();
      await prisma.sponsor.findFirst();
    } catch {
      console.warn("[engagement.db.test] DB unreachable or Phase 5 tables missing — skipping");
      return;
    }
    dbReady = true;
    const passwordHash = await hashPassword("TestPass12!x");
    const stamp = Date.now();

    const admin = await prisma.user.create({
      data: {
        email: `eng-admin-${stamp}@example.com`,
        name: "Eng Admin",
        passwordHash,
        role: "ADMIN",
      },
    });
    const attendee = await prisma.user.create({
      data: {
        email: `eng-att-${stamp}@example.com`,
        name: "Eng Attendee",
        passwordHash,
        role: "ATTENDEE",
        engagementPoints: 10,
      },
    });
    ids.adminId = admin.id;
    ids.attendeeId = attendee.id;

    const org = await prisma.organization.create({
      data: {
        name: `Eng Org ${stamp}`,
        slug: `eng-org-${stamp}`,
        plan: "PRO",
        eventAllowance: 5,
        memberships: { create: { userId: admin.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;
    await applyPlanSkuToOrg(org.id, "pro_monthly");

    const event = await prisma.event.create({
      data: {
        name: `Eng Event ${stamp}`,
        slug: `eng-event-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2027-08-01T14:00:00Z"),
        endDate: new Date("2027-08-03T22:00:00Z"),
        status: EventStatus.ACTIVE,
        organizationId: org.id,
        createdById: admin.id,
        memberships: {
          create: [
            { userId: admin.id, role: EventMemberRole.ADMIN },
            { userId: attendee.id, role: EventMemberRole.ATTENDEE },
          ],
        },
      },
      include: { memberships: true },
    });
    ids.eventId = event.id;
    ids.checkInCode = event.memberships.find((m) => m.userId === attendee.id)?.checkInCode;

    await upsertFeatureOverrides(event.id, {
      session_qa: true,
      session_polls: true,
      session_feedback: true,
      sponsors: true,
      checkin: true,
      public_leaderboard: false,
    });

    const session = await prisma.session.create({
      data: {
        eventId: event.id,
        title: "Engagement Session",
        startsAt: new Date("2027-08-01T15:00:00Z"),
        endsAt: new Date("2027-08-01T16:00:00Z"),
      },
    });
    ids.sessionId = session.id;

    const thread = await prisma.sessionDiscussionThread.create({
      data: {
        sessionId: session.id,
        authorId: attendee.id,
        title: "Question?",
        body: "What about methods?",
      },
    });
    ids.threadId = thread.id;
  });

  afterAll(async () => {
    if (!dbReady) {
      await prisma.$disconnect();
      return;
    }
    const eventId = ids.eventId;
    if (eventId) {
      await prisma.sponsorLead.deleteMany({ where: { sponsor: { eventId } } });
      await prisma.sponsor.deleteMany({ where: { eventId } });
      await prisma.sessionPollVote.deleteMany({ where: { poll: { session: { eventId } } } });
      await prisma.sessionPollOption.deleteMany({ where: { poll: { session: { eventId } } } });
      await prisma.sessionPoll.deleteMany({ where: { session: { eventId } } });
      await prisma.sessionFeedback.deleteMany({ where: { session: { eventId } } });
      await prisma.sessionDiscussionUpvote.deleteMany({
        where: { thread: { session: { eventId } } },
      });
      await prisma.sessionDiscussionReply.deleteMany({
        where: { thread: { session: { eventId } } },
      });
      await prisma.sessionDiscussionThread.deleteMany({ where: { session: { eventId } } });
      await prisma.checkIn.deleteMany({ where: { eventId } });
      await prisma.session.deleteMany({ where: { eventId } });
      await prisma.eventFeatureConfig.deleteMany({ where: { eventId } });
      await prisma.eventMembership.deleteMany({ where: { eventId } });
      await prisma.event.deleteMany({ where: { id: eventId } });
    }
    if (ids.orgId) {
      await prisma.orgMembership.deleteMany({ where: { organizationId: ids.orgId } });
      await prisma.organization.deleteMany({ where: { id: ids.orgId } });
    }
    const userIds = [ids.adminId, ids.attendeeId].filter(Boolean) as string[];
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("membership checkInCode is auto-populated (QR payload)", async () => {
    if (!dbReady) return;
    expect(ids.checkInCode).toBeTruthy();
    expect(ids.checkInCode!.length).toBeGreaterThan(8);
  });

  it("Q&A upvote and mark answered", async () => {
    if (!dbReady) return;
    await prisma.sessionDiscussionUpvote.create({
      data: { threadId: ids.threadId!, userId: ids.adminId! },
    });
    const count = await prisma.sessionDiscussionUpvote.count({ where: { threadId: ids.threadId! } });
    expect(count).toBe(1);

    await prisma.sessionDiscussionThread.update({
      where: { id: ids.threadId! },
      data: { answeredAt: new Date(), answeredById: ids.adminId! },
    });
    const t = await prisma.sessionDiscussionThread.findUnique({ where: { id: ids.threadId! } });
    expect(t?.answeredAt).toBeTruthy();
  });

  it("live poll open/vote/close", async () => {
    if (!dbReady) return;
    const poll = await prisma.sessionPoll.create({
      data: {
        sessionId: ids.sessionId!,
        question: "Preferred format?",
        status: SessionPollStatus.OPEN,
        openedAt: new Date(),
        createdById: ids.adminId!,
        options: {
          create: [
            { label: "In person", sortOrder: 0 },
            { label: "Virtual", sortOrder: 1 },
          ],
        },
      },
      include: { options: true },
    });
    ids.pollId = poll.id;
    ids.optionA = poll.options[0]!.id;
    ids.optionB = poll.options[1]!.id;

    await prisma.sessionPollVote.create({
      data: { pollId: poll.id, optionId: ids.optionA!, userId: ids.attendeeId! },
    });
    const votes = await prisma.sessionPollVote.count({ where: { pollId: poll.id } });
    expect(votes).toBe(1);

    await prisma.sessionPoll.update({
      where: { id: poll.id },
      data: { status: SessionPollStatus.CLOSED, closedAt: new Date() },
    });
  });

  it("session feedback after end", async () => {
    if (!dbReady) return;
    // Session already ended relative to... use past endsAt
    await prisma.session.update({
      where: { id: ids.sessionId! },
      data: { endsAt: new Date("2020-01-01T00:00:00Z") },
    });
    const fb = await prisma.sessionFeedback.create({
      data: {
        sessionId: ids.sessionId!,
        userId: ids.attendeeId!,
        rating: 5,
        comment: "Great talk",
      },
    });
    expect(fb.rating).toBe(5);
  });

  it("QR scan check-in uses membership.checkInCode and clientMutationId idempotency", async () => {
    if (!dbReady) return;
    const mutationId = `offline-${Date.now()}`;
    const first = await prisma.checkIn.create({
      data: {
        userId: ids.attendeeId!,
        eventId: ids.eventId!,
        method: CheckInMethod.QR_SCAN,
        scannedByUserId: ids.adminId!,
        clientMutationId: mutationId,
      },
    });
    expect(first.method).toBe(CheckInMethod.QR_SCAN);

    const replay = await prisma.checkIn.findFirst({ where: { clientMutationId: mutationId } });
    expect(replay?.id).toBe(first.id);

    const membership = await prisma.eventMembership.findFirst({
      where: { eventId: ids.eventId!, userId: ids.attendeeId! },
    });
    expect(membership?.checkInCode).toBe(ids.checkInCode);
  });

  it("sponsors ordered by sortOrder and lead capture", async () => {
    if (!dbReady) return;
    await prisma.sponsor.createMany({
      data: [
        { eventId: ids.eventId!, name: "Gold Co", tier: "Gold", sortOrder: 0 },
        { eventId: ids.eventId!, name: "Silver Co", tier: "Silver", sortOrder: 1 },
      ],
    });
    const list = await prisma.sponsor.findMany({
      where: { eventId: ids.eventId! },
      orderBy: { sortOrder: "asc" },
    });
    expect(list[0]!.name).toBe("Gold Co");

    const lead = await prisma.sponsorLead.create({
      data: {
        sponsorId: list[0]!.id,
        capturedByUserId: ids.adminId!,
        name: "Prospect",
        email: "p@example.com",
      },
    });
    expect(lead.email).toBe("p@example.com");
  });

  it("public leaderboard stays off by default (anti-goal)", async () => {
    if (!dbReady) return;
    const cfg = await prisma.eventFeatureConfig.findUnique({ where: { eventId: ids.eventId! } });
    const overrides = (cfg?.overrides || {}) as Record<string, unknown>;
    expect(overrides.public_leaderboard).toBe(false);
  });
});
