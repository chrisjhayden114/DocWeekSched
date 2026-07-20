import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EventMemberRole, EventStatus, OrgRole, PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/auth";
import { newJoinToken } from "../lib/inviteTokens";
import { clampPercent } from "@event-app/shared";

describe("venue maps + pins (DB)", () => {
  const prisma = new PrismaClient();
  const ids: {
    orgId?: string;
    eventId?: string;
    roomId?: string;
    otherRoomId?: string;
    mapId?: string;
    pinId?: string;
    adminId?: string;
    attendeeId?: string;
  } = {};
  let dbReady = false;

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await prisma.venueMap.findFirst();
    } catch {
      console.warn("[maps.db.test] DB unreachable or VenueMap missing — skipping");
      return;
    }
    dbReady = true;
    const passwordHash = await hashPassword("TestPass12!x");
    const stamp = Date.now();

    const admin = await prisma.user.create({
      data: {
        email: `maps-admin-${stamp}@example.com`,
        name: "Maps Admin",
        role: "ADMIN",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const attendee = await prisma.user.create({
      data: {
        email: `maps-att-${stamp}@example.com`,
        name: "Maps Attendee",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    ids.adminId = admin.id;
    ids.attendeeId = attendee.id;

    const org = await prisma.organization.create({
      data: {
        name: "Maps Org",
        slug: `maps-org-${stamp}`,
        plan: "INTERNAL",
        eventAllowance: null,
        memberships: { create: { userId: admin.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;

    const { hash } = newJoinToken();
    const event = await prisma.event.create({
      data: {
        name: "Maps Event",
        slug: `maps-evt-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2027-06-01T14:00:00Z"),
        endDate: new Date("2027-06-03T22:00:00Z"),
        status: EventStatus.ACTIVE,
        organizationId: org.id,
        createdById: admin.id,
        joinTokenHash: hash,
        attendeeCap: 1000,
        memberships: {
          create: [
            { userId: admin.id, role: EventMemberRole.ADMIN },
            { userId: attendee.id, role: EventMemberRole.ATTENDEE },
          ],
        },
      },
    });
    ids.eventId = event.id;

    const room = await prisma.room.create({
      data: { eventId: event.id, name: "Ballroom A" },
    });
    const other = await prisma.room.create({
      data: { eventId: event.id, name: "Hall B" },
    });
    ids.roomId = room.id;
    ids.otherRoomId = other.id;
  });

  afterAll(async () => {
    if (ids.eventId) {
      await prisma.event.delete({ where: { id: ids.eventId } }).catch(() => null);
    }
    if (ids.orgId) {
      await prisma.organization.delete({ where: { id: ids.orgId } }).catch(() => null);
    }
    if (ids.adminId) await prisma.user.delete({ where: { id: ids.adminId } }).catch(() => null);
    if (ids.attendeeId) await prisma.user.delete({ where: { id: ids.attendeeId } }).catch(() => null);
    await prisma.$disconnect();
  });

  it("creates map and pin CRUD with room linking", async () => {
    if (!dbReady) return;

    const map = await prisma.venueMap.create({
      data: {
        eventId: ids.eventId!,
        name: "Floor 1",
        imageUrl: "data:image/png;base64,abc",
        sortOrder: 0,
      },
    });
    ids.mapId = map.id;
    expect(map.name).toBe("Floor 1");

    const pin = await prisma.mapPin.create({
      data: {
        mapId: map.id,
        roomLabel: "Ballroom",
        x: clampPercent(25),
        y: clampPercent(40),
        linkedRoomId: ids.roomId!,
      },
      include: { linkedRoom: true },
    });
    ids.pinId = pin.id;
    expect(pin.linkedRoom?.name).toBe("Ballroom A");
    expect(pin.x).toBe(25);
    expect(pin.y).toBe(40);

    const moved = await prisma.mapPin.update({
      where: { id: pin.id },
      data: { x: clampPercent(55.5), y: clampPercent(10), linkedRoomId: ids.otherRoomId! },
      include: { linkedRoom: true },
    });
    expect(moved.x).toBe(55.5);
    expect(moved.y).toBe(10);
    expect(moved.linkedRoomId).toBe(ids.otherRoomId);
    expect(moved.linkedRoom?.name).toBe("Hall B");

    const byRoom = await prisma.mapPin.findFirst({
      where: { linkedRoomId: ids.otherRoomId!, map: { eventId: ids.eventId! } },
    });
    expect(byRoom?.id).toBe(pin.id);

    await prisma.mapPin.delete({ where: { id: pin.id } });
    expect(await prisma.mapPin.findUnique({ where: { id: pin.id } })).toBeNull();

    const pin2 = await prisma.mapPin.create({
      data: {
        mapId: map.id,
        roomLabel: "Orphan",
        x: 10,
        y: 10,
        linkedRoomId: ids.roomId!,
      },
    });
    await prisma.room.delete({ where: { id: ids.roomId! } });
    const afterRoomDelete = await prisma.mapPin.findUnique({ where: { id: pin2.id } });
    expect(afterRoomDelete?.linkedRoomId).toBeNull();

    await prisma.venueMap.delete({ where: { id: map.id } });
    expect(await prisma.mapPin.findUnique({ where: { id: pin2.id } })).toBeNull();
  });

  it("supports multiple maps per event", async () => {
    if (!dbReady) return;
    const a = await prisma.venueMap.create({
      data: { eventId: ids.eventId!, name: "A", imageUrl: "data:image/png;base64,a", sortOrder: 0 },
    });
    const b = await prisma.venueMap.create({
      data: { eventId: ids.eventId!, name: "B", imageUrl: "data:image/png;base64,b", sortOrder: 1 },
    });
    const list = await prisma.venueMap.findMany({
      where: { eventId: ids.eventId! },
      orderBy: { sortOrder: "asc" },
    });
    expect(list.map((m) => m.name)).toEqual(expect.arrayContaining(["A", "B"]));
    await prisma.venueMap.deleteMany({ where: { id: { in: [a.id, b.id] } } });
  });
});
