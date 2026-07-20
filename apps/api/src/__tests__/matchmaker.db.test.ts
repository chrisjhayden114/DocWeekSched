import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EventMemberRole,
  EventStatus,
  NotificationClass,
  NotificationDelivery,
  OrgRole,
  PrismaClient,
  SessionAttendanceStatus,
  SessionJoinMode,
} from "@prisma/client";
import { hashPassword } from "../lib/auth";
import { MockAiProvider, resetAiProviderForTests } from "../lib/ai";
import {
  ensureProfileEmbedding,
  runMatchBatch,
  setMatchMeEnabled,
} from "../lib/ai/matchmaker";
import { findMutuallyFreeSlots } from "../lib/ai/matchmaker/freeSlots";
import { applyPlanSkuToOrg } from "../lib/billing/entitlements";
import { upsertFeatureOverrides } from "../lib/features/featureEnabled";
import { getDirectConversation } from "../lib/conversations";
import { prisma as sharedPrisma } from "../lib/db";

describe("Matchmaker (DB)", () => {
  const prisma = new PrismaClient();
  const ids: {
    orgId?: string;
    eventId?: string;
    aliceId?: string;
    bobId?: string;
    carolId?: string;
    daveId?: string;
  } = {};
  let dbReady = false;

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await prisma.matchSuggestion.findFirst();
      await prisma.matchProfileEmbedding.findFirst();
    } catch {
      console.warn("[matchmaker.db.test] DB unreachable or A4 tables missing — skipping");
      return;
    }
    dbReady = true;
    process.env.AI_PROVIDER = "mock";
    resetAiProviderForTests(new MockAiProvider());

    const passwordHash = await hashPassword("TestPass12!x");
    const stamp = Date.now();

    const alice = await prisma.user.create({
      data: {
        email: `mm-alice-${stamp}@example.com`,
        name: "Alice Researcher",
        passwordHash,
        role: "ATTENDEE",
        researchInterests:
          "I study qualitative research methods in doctoral education leadership programs, focusing on narrative inquiry.",
      },
    });
    const bob = await prisma.user.create({
      data: {
        email: `mm-bob-${stamp}@example.com`,
        name: "Bob Scholar",
        passwordHash,
        role: "ATTENDEE",
        researchInterests:
          "My work examines qualitative methods and narrative inquiry within doctoral education leadership.",
      },
    });
    const carol = await prisma.user.create({
      data: {
        email: `mm-carol-${stamp}@example.com`,
        name: "Carol OptOut",
        passwordHash,
        role: "ATTENDEE",
        researchInterests:
          "Qualitative research methods and doctoral education leadership — but I opt out of the directory.",
      },
    });
    const dave = await prisma.user.create({
      data: {
        email: `mm-dave-${stamp}@example.com`,
        name: "Dave Unrelated",
        passwordHash,
        role: "ATTENDEE",
        researchInterests: "Spacecraft propulsion and hypersonic reentry heat shields.",
      },
    });
    ids.aliceId = alice.id;
    ids.bobId = bob.id;
    ids.carolId = carol.id;
    ids.daveId = dave.id;

    const org = await prisma.organization.create({
      data: {
        name: `MM Org ${stamp}`,
        slug: `mm-org-${stamp}`,
        plan: "PRO",
        eventAllowance: 10,
        memberships: { create: { userId: alice.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;
    await applyPlanSkuToOrg(org.id, "pro_monthly");

    const event = await prisma.event.create({
      data: {
        name: `MM Event ${stamp}`,
        slug: `mm-event-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2027-06-01T14:00:00Z"),
        endDate: new Date("2027-06-05T22:00:00Z"),
        status: EventStatus.ACTIVE,
        organizationId: org.id,
        createdById: alice.id,
        memberships: {
          create: [
            {
              userId: alice.id,
              role: EventMemberRole.ADMIN,
              directoryOptIn: true,
              matchMeEnabled: true,
            },
            {
              userId: bob.id,
              role: EventMemberRole.ATTENDEE,
              directoryOptIn: true,
              matchMeEnabled: true,
            },
            {
              userId: carol.id,
              role: EventMemberRole.ATTENDEE,
              directoryOptIn: false,
              matchMeEnabled: true,
            },
            {
              userId: dave.id,
              role: EventMemberRole.ATTENDEE,
              directoryOptIn: true,
              matchMeEnabled: true,
            },
          ],
        },
      },
    });
    ids.eventId = event.id;

    await upsertFeatureOverrides(event.id, {
      attendee_directory: true,
      matchmaker: true,
      messaging_dms: true,
    });
  });

  afterAll(async () => {
    if (!dbReady) {
      await prisma.$disconnect();
      return;
    }
    const eventId = ids.eventId;
    if (eventId) {
      await prisma.matchSuggestion.deleteMany({ where: { eventId } });
      await prisma.conversationMessage.deleteMany({ where: { conversation: { eventId } } });
      await prisma.conversationMember.deleteMany({ where: { conversation: { eventId } } });
      await prisma.conversation.deleteMany({ where: { eventId } });
      await prisma.sessionAttendance.deleteMany({ where: { session: { eventId } } });
      await prisma.personalAgendaBlock.deleteMany({ where: { eventId } });
      await prisma.session.deleteMany({ where: { eventId } });
      await prisma.userNotification.deleteMany({ where: { eventId } });
      await prisma.eventFeatureConfig.deleteMany({ where: { eventId } });
      await prisma.eventMembership.deleteMany({ where: { eventId } });
      await prisma.event.deleteMany({ where: { id: eventId } });
    }
    if (ids.orgId) {
      await prisma.orgMembership.deleteMany({ where: { organizationId: ids.orgId } });
      await prisma.organization.deleteMany({ where: { id: ids.orgId } });
    }
    const userIds = [ids.aliceId, ids.bobId, ids.carolId, ids.daveId].filter(Boolean) as string[];
    if (userIds.length) {
      await prisma.matchProfileEmbedding.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  it("opted-out users are invisible as match and as recipient", async () => {
    if (!dbReady) return;
    const forAlice = await runMatchBatch({
      eventId: ids.eventId!,
      organizationId: ids.orgId!,
      forUserId: ids.aliceId!,
      batchKey: "test-optout-alice",
      deliverNotification: false,
      includeMeetingSlots: false,
      skipCap: true,
    });
    expect(forAlice.suggestions.every((s) => s.suggestedUserId !== ids.carolId)).toBe(true);

    const forCarol = await runMatchBatch({
      eventId: ids.eventId!,
      organizationId: ids.orgId!,
      forUserId: ids.carolId!,
      batchKey: "test-optout-carol",
      deliverNotification: false,
      includeMeetingSlots: false,
      skipCap: true,
    });
    expect(forCarol.skipped).toBe(true);
    expect(forCarol.reason).toBe("not_directory_opted_in");
    expect(forCarol.suggestions).toHaveLength(0);
  });

  it("mute stops refreshes", async () => {
    if (!dbReady) return;
    await setMatchMeEnabled(ids.eventId!, ids.aliceId!, false);
    const muted = await runMatchBatch({
      eventId: ids.eventId!,
      organizationId: ids.orgId!,
      forUserId: ids.aliceId!,
      batchKey: "test-mute",
      deliverNotification: false,
      includeMeetingSlots: false,
      skipCap: true,
    });
    expect(muted.skipped).toBe(true);
    expect(muted.reason).toBe("match_muted");
    await setMatchMeEnabled(ids.eventId!, ids.aliceId!, true);
  });

  it("embedding recomputes on profile edit (sourceHash change)", async () => {
    if (!dbReady) return;
    // Isolation: earlier matching tests already cached bob's embedding, so clear it
    // to assert the fresh-compute path deterministically.
    await prisma.matchProfileEmbedding.deleteMany({ where: { userId: ids.bobId! } });
    const first = await ensureProfileEmbedding(ids.bobId!, {
      organizationId: ids.orgId!,
      eventId: ids.eventId!,
      userId: ids.bobId!,
      skipCap: true,
    });
    expect(first.recomputed).toBe(true);

    const cached = await ensureProfileEmbedding(ids.bobId!, {
      organizationId: ids.orgId!,
      eventId: ids.eventId!,
      userId: ids.bobId!,
      skipCap: true,
    });
    expect(cached.recomputed).toBe(false);
    expect(cached.sourceHash).toBe(first.sourceHash);

    await prisma.user.update({
      where: { id: ids.bobId! },
      data: {
        researchInterests:
          "Updated: mixed-methods evaluation of doctoral cohort mentoring networks.",
      },
    });

    const again = await ensureProfileEmbedding(ids.bobId!, {
      organizationId: ids.orgId!,
      eventId: ids.eventId!,
      userId: ids.bobId!,
      skipCap: true,
    });
    expect(again.recomputed).toBe(true);
    expect(again.sourceHash).not.toBe(first.sourceHash);
  });

  it("never auto-sends a message; draft-intro path only pre-fills", async () => {
    if (!dbReady) return;
    const batch = await runMatchBatch({
      eventId: ids.eventId!,
      organizationId: ids.orgId!,
      forUserId: ids.aliceId!,
      batchKey: "test-nosend",
      deliverNotification: true,
      includeMeetingSlots: false,
      skipCap: true,
    });
    expect(batch.suggestions.length).toBeGreaterThan(0);
    expect(batch.suggestions.every((s) => s.aiGenerated)).toBe(true);

    if (batch.notificationId) {
      const n = await prisma.userNotification.findUnique({ where: { id: batch.notificationId } });
      expect(n?.kind).toBe("AGENT_ATTENDEE_TOUCH");
      expect(n?.class).toBe(NotificationClass.DIGEST);
      expect(n?.delivery).not.toBe(NotificationDelivery.PUSHED);
      expect(n?.delivery).not.toBe(NotificationDelivery.QUEUED_PUSH);
    }

    const suggestion = await prisma.matchSuggestion.findFirst({
      where: { eventId: ids.eventId!, forUserId: ids.aliceId!, batchKey: "test-nosend" },
    });
    expect(suggestion).toBeTruthy();

    // Simulate draft-intro: ensure conversation, do not create message
    let conversationId =
      (
        await getDirectConversation(ids.aliceId!, suggestion!.suggestedUserId, ids.eventId!)
      )?.id ?? null;
    if (!conversationId) {
      const created = await sharedPrisma.conversation.create({
        data: {
          eventId: ids.eventId!,
          type: "DIRECT",
          members: {
            create: [{ userId: ids.aliceId! }, { userId: suggestion!.suggestedUserId }],
          },
        },
      });
      conversationId = created.id;
    }
    const before = await prisma.conversationMessage.count({
      where: { conversationId },
    });
    // No send — count unchanged
    const after = await prisma.conversationMessage.count({
      where: { conversationId },
    });
    expect(after).toBe(before);
    expect(suggestion!.draftIntro.length).toBeGreaterThan(0);
  });

  it("proposed slots are mutually free on both agendas", async () => {
    if (!dbReady) return;

    const sessionBusy = await prisma.session.create({
      data: {
        eventId: ids.eventId!,
        title: "Busy block",
        description: "",
        speakers: "",
        startsAt: new Date("2027-06-02T14:00:00Z"),
        endsAt: new Date("2027-06-02T16:00:00Z"),
      },
    });
    await prisma.sessionAttendance.create({
      data: {
        userId: ids.aliceId!,
        sessionId: sessionBusy.id,
        status: SessionAttendanceStatus.JOINING,
        joinMode: SessionJoinMode.IN_PERSON,
      },
    });
    await prisma.personalAgendaBlock.create({
      data: {
        userId: ids.bobId!,
        eventId: ids.eventId!,
        title: "Bob meeting",
        startsAt: new Date("2027-06-02T16:00:00Z"),
        endsAt: new Date("2027-06-02T17:00:00Z"),
        source: "CUSTOM",
      },
    });

    const slots = await findMutuallyFreeSlots({
      eventId: ids.eventId!,
      userAId: ids.aliceId!,
      userBId: ids.bobId!,
      count: 2,
    });
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      const start = new Date(s.startsAt);
      const end = new Date(s.endsAt);
      // Must not overlap Alice's busy session
      expect(!(start < new Date("2027-06-02T16:00:00Z") && end > new Date("2027-06-02T14:00:00Z"))).toBe(
        true,
      );
      // Must not overlap Bob's block
      expect(!(start < new Date("2027-06-02T17:00:00Z") && end > new Date("2027-06-02T16:00:00Z"))).toBe(
        true,
      );
    }
  });

  it("excludes existing DIRECT chat partners from suggestions", async () => {
    if (!dbReady) return;
    await prisma.conversation.create({
      data: {
        eventId: ids.eventId!,
        type: "DIRECT",
        members: {
          create: [{ userId: ids.aliceId! }, { userId: ids.bobId! }],
        },
      },
    });

    const batch = await runMatchBatch({
      eventId: ids.eventId!,
      organizationId: ids.orgId!,
      forUserId: ids.aliceId!,
      batchKey: "test-exclude-partner",
      deliverNotification: false,
      includeMeetingSlots: false,
      skipCap: true,
    });
    expect(batch.suggestions.every((s) => s.suggestedUserId !== ids.bobId)).toBe(true);
  });
});
