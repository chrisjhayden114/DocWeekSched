// Moved out of agenda.unit.test.ts (FIX_PLAN E22): a DB suite must live in a
// *.db.test.ts file so the destructive guard and the shared DB preflight
// (skip-vs-fail rule) apply to it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "crypto";
import { EventMemberRole, EventStatus, OrgRole, PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/auth";
import { newJoinToken } from "../lib/inviteTokens";

describe("ICS token lookup (DB)", () => {
  const prisma = new PrismaClient();
  const ids: { orgId?: string; eventId?: string; userId?: string } = {};

  beforeAll(async () => {
    const stamp = Date.now();
    const passwordHash = await hashPassword("TestPass12!x");
    const user = await prisma.user.create({
      data: {
        email: `ics-${stamp}@example.com`,
        name: "ICS User",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    ids.userId = user.id;
    const org = await prisma.organization.create({
      data: {
        name: "ICS Org",
        slug: `ics-org-${stamp}`,
        plan: "INTERNAL",
        memberships: { create: { userId: user.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;
    const { hash } = newJoinToken();
    const event = await prisma.event.create({
      data: {
        name: "ICS Event",
        slug: `ics-evt-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2027-01-01"),
        endDate: new Date("2027-01-02"),
        status: EventStatus.ACTIVE,
        organizationId: org.id,
        createdById: user.id,
        joinTokenHash: hash,
        memberships: { create: { userId: user.id, role: EventMemberRole.ADMIN } },
      },
    });
    ids.eventId = event.id;
  });

  afterAll(async () => {
    if (ids.eventId) await prisma.event.delete({ where: { id: ids.eventId } }).catch(() => null);
    if (ids.orgId) await prisma.organization.delete({ where: { id: ids.orgId } }).catch(() => null);
    if (ids.userId) await prisma.user.delete({ where: { id: ids.userId } }).catch(() => null);
    await prisma.$disconnect();
  });

  it("stores hashed token and finds by hash", async () => {
    const raw = randomBytes(24).toString("base64url");
    const tokenHash = createHash("sha256").update(raw).digest("hex");
    await prisma.icsFeedToken.create({
      data: { userId: ids.userId!, eventId: ids.eventId!, tokenHash },
    });
    const found = await prisma.icsFeedToken.findFirst({ where: { tokenHash, revokedAt: null } });
    expect(found?.userId).toBe(ids.userId);
    expect(found?.eventId).toBe(ids.eventId);
  });
});
