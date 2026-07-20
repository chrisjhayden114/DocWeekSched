import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EventMemberRole,
  EventStatus,
  OrgRole,
  PrismaClient,
  SessionJoinMode,
} from "@prisma/client";
import { hashPassword } from "../lib/auth";
import { newJoinToken } from "../lib/inviteTokens";
import {
  expireAllHolds,
  joinSessionOrWaitlist,
  leaveSessionAttendance,
  WAITLIST_SEAT_HOLD_HOURS,
} from "../lib/waitlist/capacity";

describe("session capacity + waitlist (DB)", () => {
  const prisma = new PrismaClient();
  const ids: {
    orgId?: string;
    eventId?: string;
    sessionId?: string;
    unlimitedSessionId?: string;
    userA?: string;
    userB?: string;
    userC?: string;
  } = {};
  let dbReady = false;

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await prisma.waitlistEntry.findFirst();
    } catch {
      console.warn("[waitlist.db.test] DB unreachable or WaitlistEntry missing — skipping");
      return;
    }
    dbReady = true;
    const passwordHash = await hashPassword("TestPass12!x");
    const stamp = Date.now();

    const mkUser = async (label: string) =>
      prisma.user.create({
        data: {
          email: `wl-${label}-${stamp}@example.com`,
          name: `Waitlist ${label}`,
          role: "ATTENDEE",
          passwordHash,
          emailVerifiedAt: new Date(),
        },
      });

    const userA = await mkUser("a");
    const userB = await mkUser("b");
    const userC = await mkUser("c");
    ids.userA = userA.id;
    ids.userB = userB.id;
    ids.userC = userC.id;

    const org = await prisma.organization.create({
      data: {
        name: "Waitlist Org",
        slug: `wl-org-${stamp}`,
        plan: "INTERNAL",
        eventAllowance: null,
        memberships: { create: { userId: userA.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;

    const { hash } = newJoinToken();
    const event = await prisma.event.create({
      data: {
        name: "Waitlist Event",
        slug: `wl-evt-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2027-01-01T14:00:00Z"),
        endDate: new Date("2027-01-03T22:00:00Z"),
        status: EventStatus.ACTIVE,
        organizationId: org.id,
        createdById: userA.id,
        joinTokenHash: hash,
        attendeeCap: 100000,
        memberships: {
          create: [
            { userId: userA.id, role: EventMemberRole.ADMIN },
            { userId: userB.id, role: EventMemberRole.ATTENDEE },
            { userId: userC.id, role: EventMemberRole.ATTENDEE },
          ],
        },
      },
    });
    ids.eventId = event.id;

    const session = await prisma.session.create({
      data: {
        eventId: event.id,
        title: "Cap 1 in-person",
        startsAt: new Date("2027-01-01T15:00:00Z"),
        endsAt: new Date("2027-01-01T16:00:00Z"),
        inPersonCapacity: 1,
        virtualCapacity: 1,
      },
    });
    ids.sessionId = session.id;

    const unlimited = await prisma.session.create({
      data: {
        eventId: event.id,
        title: "Unlimited",
        startsAt: new Date("2027-01-01T17:00:00Z"),
        endsAt: new Date("2027-01-01T18:00:00Z"),
        inPersonCapacity: null,
        virtualCapacity: null,
      },
    });
    ids.unlimitedSessionId = unlimited.id;
  });

  afterAll(async () => {
    if (!dbReady) {
      await prisma.$disconnect().catch(() => undefined);
      return;
    }
    if (ids.sessionId) {
      await prisma.waitlistEntry.deleteMany({ where: { sessionId: ids.sessionId } });
      await prisma.sessionAttendance.deleteMany({ where: { sessionId: ids.sessionId } });
    }
    if (ids.unlimitedSessionId) {
      await prisma.waitlistEntry.deleteMany({ where: { sessionId: ids.unlimitedSessionId } });
      await prisma.sessionAttendance.deleteMany({ where: { sessionId: ids.unlimitedSessionId } });
      await prisma.session.deleteMany({ where: { id: ids.unlimitedSessionId } });
    }
    if (ids.sessionId) await prisma.session.deleteMany({ where: { id: ids.sessionId } });
    if (ids.eventId) {
      await prisma.eventMembership.deleteMany({ where: { eventId: ids.eventId } });
      await prisma.event.deleteMany({ where: { id: ids.eventId } });
    }
    if (ids.orgId) {
      await prisma.orgMembership.deleteMany({ where: { organizationId: ids.orgId } });
      await prisma.organization.deleteMany({ where: { id: ids.orgId } });
    }
    const userIds = [ids.userA, ids.userB, ids.userC].filter(Boolean) as string[];
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("null capacity remains unlimited", async () => {
    if (!dbReady) return;
    const a = await joinSessionOrWaitlist({
      sessionId: ids.unlimitedSessionId!,
      userId: ids.userA!,
      mode: SessionJoinMode.IN_PERSON,
    });
    const b = await joinSessionOrWaitlist({
      sessionId: ids.unlimitedSessionId!,
      userId: ids.userB!,
      mode: SessionJoinMode.IN_PERSON,
    });
    expect(a.kind).toBe("joined");
    expect(b.kind).toBe("joined");
    const count = await prisma.sessionAttendance.count({
      where: { sessionId: ids.unlimitedSessionId!, status: "JOINING", joinMode: "IN_PERSON" },
    });
    expect(count).toBe(2);
  });

  it("fills to capacity then waitlists", async () => {
    if (!dbReady) return;
    await prisma.waitlistEntry.deleteMany({ where: { sessionId: ids.sessionId! } });
    await prisma.sessionAttendance.deleteMany({ where: { sessionId: ids.sessionId! } });

    const first = await joinSessionOrWaitlist({
      sessionId: ids.sessionId!,
      userId: ids.userA!,
      mode: "IN_PERSON",
    });
    expect(first.kind).toBe("joined");

    const second = await joinSessionOrWaitlist({
      sessionId: ids.sessionId!,
      userId: ids.userB!,
      mode: "IN_PERSON",
    });
    expect(second.kind).toBe("waitlisted");
    if (second.kind === "waitlisted") {
      expect(second.position).toBe(1);
      expect(second.message).toMatch(/full \(1\/1 in person\)/i);
    }
  });

  it("concurrent race: last seat → exactly one join + one waitlist", async () => {
    if (!dbReady) return;
    await prisma.waitlistEntry.deleteMany({ where: { sessionId: ids.sessionId! } });
    await prisma.sessionAttendance.deleteMany({ where: { sessionId: ids.sessionId! } });

    const [r1, r2] = await Promise.all([
      joinSessionOrWaitlist({ sessionId: ids.sessionId!, userId: ids.userA!, mode: "IN_PERSON" }),
      joinSessionOrWaitlist({ sessionId: ids.sessionId!, userId: ids.userB!, mode: "IN_PERSON" }),
    ]);

    const kinds = [r1.kind, r2.kind].sort();
    expect(kinds).toEqual(["joined", "waitlisted"]);

    const joining = await prisma.sessionAttendance.count({
      where: { sessionId: ids.sessionId!, status: "JOINING", joinMode: "IN_PERSON" },
    });
    const waiting = await prisma.waitlistEntry.count({
      where: { sessionId: ids.sessionId!, mode: "IN_PERSON" },
    });
    expect(joining).toBe(1);
    expect(waiting).toBe(1);
  });

  it("promotion order: leave frees seat for #1 then #2", async () => {
    if (!dbReady) return;
    await prisma.waitlistEntry.deleteMany({ where: { sessionId: ids.sessionId! } });
    await prisma.sessionAttendance.deleteMany({ where: { sessionId: ids.sessionId! } });

    await joinSessionOrWaitlist({ sessionId: ids.sessionId!, userId: ids.userA!, mode: "IN_PERSON" });
    await joinSessionOrWaitlist({ sessionId: ids.sessionId!, userId: ids.userB!, mode: "IN_PERSON" });
    await joinSessionOrWaitlist({ sessionId: ids.sessionId!, userId: ids.userC!, mode: "IN_PERSON" });

    const ordered = await prisma.waitlistEntry.findMany({
      where: { sessionId: ids.sessionId!, mode: "IN_PERSON" },
      orderBy: { position: "asc" },
    });
    expect(ordered.map((e) => e.userId)).toEqual([ids.userB, ids.userC]);

    const leave = await leaveSessionAttendance({
      sessionId: ids.sessionId!,
      userId: ids.userA!,
    });
    expect(leave.promotedUserId).toBe(ids.userB);

    const bHold = await prisma.waitlistEntry.findUnique({
      where: { sessionId_userId: { sessionId: ids.sessionId!, userId: ids.userB! } },
    });
    expect(bHold?.promotedAt).not.toBeNull();
    expect(bHold?.holdExpiresAt).not.toBeNull();

    // B claims seat
    const claim = await joinSessionOrWaitlist({
      sessionId: ids.sessionId!,
      userId: ids.userB!,
      mode: "IN_PERSON",
    });
    expect(claim.kind).toBe("joined");
  });

  it("hold expiry passes to the next waitlisted person", async () => {
    if (!dbReady) return;
    await prisma.waitlistEntry.deleteMany({ where: { sessionId: ids.sessionId! } });
    await prisma.sessionAttendance.deleteMany({ where: { sessionId: ids.sessionId! } });

    await joinSessionOrWaitlist({ sessionId: ids.sessionId!, userId: ids.userA!, mode: "IN_PERSON" });
    await joinSessionOrWaitlist({ sessionId: ids.sessionId!, userId: ids.userB!, mode: "IN_PERSON" });
    await joinSessionOrWaitlist({ sessionId: ids.sessionId!, userId: ids.userC!, mode: "IN_PERSON" });

    await leaveSessionAttendance({ sessionId: ids.sessionId!, userId: ids.userA! });
    // B has hold — expire it
    await prisma.waitlistEntry.updateMany({
      where: { sessionId: ids.sessionId!, userId: ids.userB! },
      data: { holdExpiresAt: new Date(Date.now() - 1000) },
    });

    await expireAllHolds();

    const bGone = await prisma.waitlistEntry.findUnique({
      where: { sessionId_userId: { sessionId: ids.sessionId!, userId: ids.userB! } },
    });
    expect(bGone).toBeNull();

    const cHold = await prisma.waitlistEntry.findUnique({
      where: { sessionId_userId: { sessionId: ids.sessionId!, userId: ids.userC! } },
    });
    expect(cHold?.promotedAt).not.toBeNull();
  });

  it("documents default hold hours", () => {
    expect(WAITLIST_SEAT_HOLD_HOURS).toBe(24);
  });
});
