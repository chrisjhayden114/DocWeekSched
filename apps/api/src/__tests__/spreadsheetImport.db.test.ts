import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "fs";
import { resolve } from "path";
import dotenv from "dotenv";

// Load monorepo /.env when running vitest from apps/api (matches API boot).
for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
  if (existsSync(p)) dotenv.config({ path: p });
}

import { EventMemberRole, EventStatus, OrgRole, PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/auth";
import { HttpError, requireEventAccess } from "../lib/authorization";

/**
 * E21 — POST /import/spreadsheet/parse.
 * The route is guarded by requireEventAccess(manage: true) after
 * resolveEventFromRequest; it reads the posted file only and touches no event
 * data. Authorization: an attendee must be rejected at the guard; a manager
 * of a DIFFERENT event must be rejected for this one even though their
 * user id and the event id are both real.
 */
describe("spreadsheet import parse (DB)", () => {
  const prisma = new PrismaClient();
  const ids: {
    orgId?: string;
    otherOrgId?: string;
    eventId?: string;
    otherEventId?: string;
    adminId?: string;
    attendeeId?: string;
    otherManagerId?: string;
  } = {};
  let dbReady = false;

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      console.warn("[spreadsheetImport.db.test] DATABASE_URL unreachable — skipping DB tests");
      return;
    }
    dbReady = true;

    const passwordHash = await hashPassword("TestPass12!x");
    const stamp = Date.now();

    const admin = await prisma.user.create({
      data: { email: `ssi-admin-${stamp}@example.com`, name: "SSI Admin", passwordHash, role: "ATTENDEE" },
    });
    const attendee = await prisma.user.create({
      data: { email: `ssi-att-${stamp}@example.com`, name: "SSI Attendee", passwordHash, role: "ATTENDEE" },
    });
    const otherManager = await prisma.user.create({
      data: { email: `ssi-other-${stamp}@example.com`, name: "SSI Other", passwordHash, role: "ATTENDEE" },
    });
    ids.adminId = admin.id;
    ids.attendeeId = attendee.id;
    ids.otherManagerId = otherManager.id;

    const org = await prisma.organization.create({
      data: {
        name: `SSI Org ${stamp}`,
        slug: `ssi-org-${stamp}`,
        memberships: { create: { userId: admin.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;

    const otherOrg = await prisma.organization.create({
      data: {
        name: `SSI Other Org ${stamp}`,
        slug: `ssi-other-org-${stamp}`,
        memberships: { create: { userId: otherManager.id, role: OrgRole.OWNER } },
      },
    });
    ids.otherOrgId = otherOrg.id;

    const event = await prisma.event.create({
      data: {
        name: `SSI Event ${stamp}`,
        slug: `ssi-event-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2027-09-01T09:00:00Z"),
        endDate: new Date("2027-09-02T18:00:00Z"),
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
    });
    ids.eventId = event.id;

    const otherEvent = await prisma.event.create({
      data: {
        name: `SSI Other Event ${stamp}`,
        slug: `ssi-other-event-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2027-10-01T09:00:00Z"),
        endDate: new Date("2027-10-02T18:00:00Z"),
        status: EventStatus.ACTIVE,
        organizationId: otherOrg.id,
        createdById: otherManager.id,
        memberships: { create: { userId: otherManager.id, role: EventMemberRole.ADMIN } },
      },
    });
    ids.otherEventId = otherEvent.id;
  });

  afterAll(async () => {
    if (!dbReady) {
      await prisma.$disconnect();
      return;
    }
    for (const eventId of [ids.eventId, ids.otherEventId]) {
      if (!eventId) continue;
      await prisma.eventMembership.deleteMany({ where: { eventId } });
      await prisma.event.delete({ where: { id: eventId } }).catch(() => undefined);
    }
    for (const orgId of [ids.orgId, ids.otherOrgId]) {
      if (!orgId) continue;
      await prisma.orgMembership.deleteMany({ where: { organizationId: orgId } });
      await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
    }
    for (const userId of [ids.adminId, ids.attendeeId, ids.otherManagerId]) {
      if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it("event admin passes the manage guard", async () => {
    if (!dbReady) return;
    const access = await requireEventAccess(ids.adminId!, ids.eventId!, { manage: true });
    expect(access.event.id).toBe(ids.eventId);
  });

  it("attendee is rejected at the manage guard", async () => {
    if (!dbReady) return;
    await expect(
      requireEventAccess(ids.attendeeId!, ids.eventId!, { manage: true }),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it("a manager of a different org's event is rejected for this event (tenancy)", async () => {
    if (!dbReady) return;
    await expect(
      requireEventAccess(ids.otherManagerId!, ids.eventId!, { manage: true }),
    ).rejects.toBeInstanceOf(HttpError);
    // and the guard passes them only on their own event
    const own = await requireEventAccess(ids.otherManagerId!, ids.otherEventId!, { manage: true });
    expect(own.event.id).toBe(ids.otherEventId);
  });
});
