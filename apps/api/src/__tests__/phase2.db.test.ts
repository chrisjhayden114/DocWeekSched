import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EventMemberRole, EventStatus, OrgRole, PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/auth";
import { newJoinToken } from "../lib/inviteTokens";
import { cloneNextEdition } from "../lib/seriesClone";

describe("SessionItem ordering + series clone (DB)", () => {
  const prisma = new PrismaClient();
  const ids: {
    orgId?: string;
    eventId?: string;
    userId?: string;
    sessionId?: string;
  } = {};
  let dbReady = false;

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReady = true;
    } catch {
      console.warn("[phase2.db.test] DATABASE_URL unreachable — skipping DB tests");
      return;
    }

    const passwordHash = await hashPassword("TestPass12!x");
    const user = await prisma.user.create({
      data: {
        email: `phase2-${Date.now()}@example.com`,
        name: "Phase2 Organizer",
        role: "ADMIN",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    ids.userId = user.id;

    const org = await prisma.organization.create({
      data: {
        name: "Phase2 Org",
        slug: `phase2-org-${Date.now()}`,
        memberships: { create: { userId: user.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;

    const { hash } = newJoinToken();
    const event = await prisma.event.create({
      data: {
        name: "Phase2 Conf 2026",
        slug: `phase2-conf-${Date.now()}`,
        timezone: "UTC",
        startDate: new Date("2026-10-01T14:00:00Z"),
        endDate: new Date("2026-10-03T22:00:00Z"),
        status: EventStatus.ACTIVE,
        organizationId: org.id,
        createdById: user.id,
        joinTokenHash: hash,
        memberships: { create: { userId: user.id, role: EventMemberRole.ADMIN } },
      },
    });
    ids.eventId = event.id;

    const track = await prisma.track.create({
      data: { eventId: event.id, name: "Main", color: "#0033A0", sortOrder: 0 },
    });
    const room = await prisma.room.create({
      data: { eventId: event.id, name: "Hall A", sortOrder: 0 },
    });
    const speaker = await prisma.speaker.create({
      data: { eventId: event.id, name: "Dr. Ordered", sortOrder: 0 },
    });

    const session = await prisma.session.create({
      data: {
        eventId: event.id,
        title: "Paper session",
        startsAt: new Date("2026-10-01T15:00:00Z"),
        endsAt: new Date("2026-10-01T16:30:00Z"),
        trackId: track.id,
        roomId: room.id,
      },
    });
    ids.sessionId = session.id;

    await prisma.sessionSpeaker.create({
      data: { sessionId: session.id, speakerId: speaker.id, sortOrder: 0 },
    });

    // Intentionally create out of title-alpha order; authored sortOrder must win.
    const itemZ = await prisma.sessionItem.create({
      data: {
        sessionId: session.id,
        title: "Zebra paper",
        sortOrder: 0,
        authors: {
          create: [
            { name: "Carol", sortOrder: 0, isPresenter: true },
            { name: "Alice", sortOrder: 1 },
            { name: "Bob", sortOrder: 2 },
          ],
        },
      },
    });
    const itemA = await prisma.sessionItem.create({
      data: {
        sessionId: session.id,
        title: "Alpha paper",
        sortOrder: 1,
        authors: {
          create: [
            { name: "Zoe", sortOrder: 0, isPresenter: true },
            { name: "Amy", sortOrder: 1 },
          ],
        },
      },
    });
    void itemZ;
    void itemA;
  });

  afterAll(async () => {
    if (!dbReady) {
      await prisma.$disconnect();
      return;
    }
    if (ids.eventId) {
      const series = await prisma.event.findUnique({
        where: { id: ids.eventId },
        select: { seriesId: true },
      });
      const editions = await prisma.event.findMany({
        where: {
          OR: [
            { id: ids.eventId },
            ...(series?.seriesId ? [{ seriesId: series.seriesId }] : []),
          ],
        },
        select: { id: true },
      });
      for (const e of editions) {
        await prisma.sessionItemAuthor.deleteMany({
          where: { sessionItem: { session: { eventId: e.id } } },
        });
        await prisma.sessionItem.deleteMany({ where: { session: { eventId: e.id } } });
        await prisma.sessionSpeaker.deleteMany({ where: { session: { eventId: e.id } } });
        await prisma.session.deleteMany({ where: { eventId: e.id } });
        await prisma.speaker.deleteMany({ where: { eventId: e.id } });
        await prisma.track.deleteMany({ where: { eventId: e.id } });
        await prisma.room.deleteMany({ where: { eventId: e.id } });
        await prisma.eventMembership.deleteMany({ where: { eventId: e.id } });
        await prisma.event.delete({ where: { id: e.id } }).catch(() => undefined);
      }
      if (series?.seriesId) {
        await prisma.eventSeries.delete({ where: { id: series.seriesId } }).catch(() => undefined);
      }
    }
    if (ids.orgId) {
      await prisma.orgMembership.deleteMany({ where: { organizationId: ids.orgId } });
      await prisma.organization.delete({ where: { id: ids.orgId } }).catch(() => undefined);
    }
    if (ids.userId) {
      await prisma.user.delete({ where: { id: ids.userId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it("returns SessionItems and authors in authored sortOrder, not alphabetically", async () => {
    if (!dbReady) return;
    const items = await prisma.sessionItem.findMany({
      where: { sessionId: ids.sessionId },
      orderBy: { sortOrder: "asc" },
      include: { authors: { orderBy: { sortOrder: "asc" } } },
    });
    expect(items.map((i) => i.title)).toEqual(["Zebra paper", "Alpha paper"]);
    expect(items[0].authors.map((a) => a.name)).toEqual(["Carol", "Alice", "Bob"]);
    // Alphabetized would be Alice, Bob, Carol — assert we did not sort by name
    expect(items[0].authors.map((a) => a.name)).not.toEqual(["Alice", "Bob", "Carol"]);
  });

  it("clones structure into a new DRAFT edition without attendees", async () => {
    if (!dbReady) return;
    const result = await cloneNextEdition(prisma, {
      sourceEventId: ids.eventId!,
      organizationId: ids.orgId!,
      createdById: ids.userId!,
      startDate: new Date("2027-10-01T14:00:00Z"),
    });

    const clone = await prisma.event.findUniqueOrThrow({
      where: { id: result.eventId },
      include: {
        tracks: true,
        rooms: true,
        speakersRoster: true,
        sessions: {
          include: {
            items: { orderBy: { sortOrder: "asc" }, include: { authors: { orderBy: { sortOrder: "asc" } } } },
            sessionSpeakers: true,
          },
        },
        memberships: true,
      },
    });

    expect(clone.status).toBe(EventStatus.DRAFT);
    expect(clone.seriesId).toBe(result.seriesId);
    expect(clone.tracks).toHaveLength(1);
    expect(clone.rooms).toHaveLength(1);
    expect(clone.speakersRoster).toHaveLength(1);
    expect(clone.sessions).toHaveLength(1);
    expect(clone.sessions[0].items.map((i) => i.title)).toEqual(["Zebra paper", "Alpha paper"]);
    expect(clone.sessions[0].items[0].authors.map((a) => a.name)).toEqual(["Carol", "Alice", "Bob"]);
    expect(clone.sessions[0].startsAt.toISOString()).toBe("2027-10-01T15:00:00.000Z");
    // Only the creating organizer membership — no cloned attendees
    expect(clone.memberships).toHaveLength(1);
    expect(clone.memberships[0].userId).toBe(ids.userId);
  });
});
