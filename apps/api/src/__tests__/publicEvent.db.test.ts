/**
 * Phase 6 — GET /event/public/:slug (side-effect-free public payload).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "fs";
import { resolve } from "path";
import dotenv from "dotenv";

for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
  if (existsSync(p)) dotenv.config({ path: p });
}

import {
  EventMemberRole,
  EventStatus,
  OrgRole,
  PrismaClient,
  SessionPublishStatus,
} from "@prisma/client";
import { hashPassword } from "../lib/auth";
import { applyPlanSkuToOrg } from "../lib/billing/entitlements";
import { newJoinToken } from "../lib/inviteTokens";
import { getPublicEventBySlug } from "../lib/publicEvent";

describe("Phase 6 public event payload (DB)", () => {
  const prisma = new PrismaClient();
  const ids: {
    orgId?: string;
    eventAId?: string;
    eventBId?: string;
    slugA?: string;
    slugB?: string;
    userId?: string;
    draftId?: string;
    archivedId?: string;
  } = {};
  let dbReady = false;
  let useCountBefore = 0;

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReady = true;
    } catch {
      console.warn("[publicEvent.db.test] DATABASE_URL unreachable — skipping");
      return;
    }

    const passwordHash = await hashPassword("TestPass12!x");
    const stamp = Date.now();
    const user = await prisma.user.create({
      data: {
        email: `pub-${stamp}@example.com`,
        name: "Public Event Org",
        role: "ADMIN",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    ids.userId = user.id;

    const org = await prisma.organization.create({
      data: {
        name: "Public Org",
        slug: `pub-org-${stamp}`,
        memberships: { create: { userId: user.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;
    await applyPlanSkuToOrg(org.id, "pro_monthly");

    const { hash: hashA } = newJoinToken();
    const slugA = `pub-conf-a-${stamp}`;
    const eventA = await prisma.event.create({
      data: {
        name: "Public Conf A",
        slug: slugA,
        description: "Alpha conference",
        timezone: "UTC",
        startDate: new Date("2026-11-01T14:00:00Z"),
        endDate: new Date("2026-11-02T22:00:00Z"),
        status: EventStatus.ACTIVE,
        organizationId: org.id,
        createdById: user.id,
        joinTokenHash: hashA,
        slugInviteEnabled: true,
        slugInviteUseCount: 3,
        venueName: "Hall Alpha",
        memberships: { create: { userId: user.id, role: EventMemberRole.ADMIN } },
      },
    });
    ids.eventAId = eventA.id;
    ids.slugA = slugA;
    useCountBefore = eventA.slugInviteUseCount;

    const speaker = await prisma.speaker.create({
      data: { eventId: eventA.id, name: "Dr. Public", title: "Prof", affiliation: "U Test", sortOrder: 0 },
    });
    const session = await prisma.session.create({
      data: {
        eventId: eventA.id,
        title: "Opening",
        publishStatus: SessionPublishStatus.PUBLISHED,
        startsAt: new Date("2026-11-01T15:00:00Z"),
        endsAt: new Date("2026-11-01T16:00:00Z"),
        sessionSpeakers: { create: { speakerId: speaker.id, sortOrder: 0 } },
        items: {
          create: {
            title: "A paper",
            abstract: "Abstract text",
            sortOrder: 0,
            authors: { create: { name: "Author One", isPresenter: true, sortOrder: 0 } },
          },
        },
      },
    });
    await prisma.session.create({
      data: {
        eventId: eventA.id,
        title: "Draft only",
        publishStatus: SessionPublishStatus.DRAFT,
        startsAt: new Date("2026-11-01T17:00:00Z"),
        endsAt: new Date("2026-11-01T18:00:00Z"),
      },
    });
    await prisma.sponsor.create({
      data: {
        eventId: eventA.id,
        name: "Acme",
        tier: "Gold",
        sortOrder: 0,
        url: "https://example.com",
      },
    });
    void session;

    const { hash: hashB } = newJoinToken();
    const slugB = `pub-conf-b-${stamp}`;
    const eventB = await prisma.event.create({
      data: {
        name: "Public Conf B",
        slug: slugB,
        timezone: "UTC",
        startDate: new Date("2026-12-01T14:00:00Z"),
        endDate: new Date("2026-12-02T22:00:00Z"),
        status: EventStatus.ACTIVE,
        organizationId: org.id,
        createdById: user.id,
        joinTokenHash: hashB,
        slugInviteEnabled: true,
        memberships: { create: { userId: user.id, role: EventMemberRole.ADMIN } },
      },
    });
    ids.eventBId = eventB.id;
    ids.slugB = slugB;

    const { hash: hashD } = newJoinToken();
    const draft = await prisma.event.create({
      data: {
        name: "Draft Conf",
        slug: `pub-draft-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2026-11-01T14:00:00Z"),
        endDate: new Date("2026-11-02T22:00:00Z"),
        status: EventStatus.DRAFT,
        organizationId: org.id,
        createdById: user.id,
        joinTokenHash: hashD,
        slugInviteEnabled: true,
        memberships: { create: { userId: user.id, role: EventMemberRole.ADMIN } },
      },
    });
    ids.draftId = draft.id;

    const { hash: hashArch } = newJoinToken();
    const archived = await prisma.event.create({
      data: {
        name: "Archived Conf",
        slug: `pub-arch-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2026-11-01T14:00:00Z"),
        endDate: new Date("2026-11-02T22:00:00Z"),
        status: EventStatus.ARCHIVED,
        organizationId: org.id,
        createdById: user.id,
        joinTokenHash: hashArch,
        slugInviteEnabled: true,
        memberships: { create: { userId: user.id, role: EventMemberRole.ADMIN } },
      },
    });
    ids.archivedId = archived.id;
  }, 60_000);

  afterAll(async () => {
    if (!dbReady) {
      await prisma.$disconnect();
      return;
    }
    const eventIds = [ids.eventAId, ids.eventBId, ids.draftId, ids.archivedId].filter(Boolean) as string[];
    await prisma.sponsor.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.sessionItemAuthor.deleteMany({
      where: { sessionItem: { session: { eventId: { in: eventIds } } } },
    });
    await prisma.sessionItem.deleteMany({ where: { session: { eventId: { in: eventIds } } } });
    await prisma.sessionSpeaker.deleteMany({ where: { session: { eventId: { in: eventIds } } } });
    await prisma.session.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.speaker.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.eventMembership.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    if (ids.orgId) {
      await prisma.orgMembership.deleteMany({ where: { organizationId: ids.orgId } });
      await prisma.organization.delete({ where: { id: ids.orgId } }).catch(() => undefined);
    }
    if (ids.userId) await prisma.user.delete({ where: { id: ids.userId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("returns published sessions/items/speakers/sponsors shape without attendee PII", async () => {
    if (!dbReady) return;
    const payload = await getPublicEventBySlug(ids.slugA!);
    expect(payload).toBeTruthy();
    expect(payload!.slug).toBe(ids.slugA);
    expect(payload!.name).toBe("Public Conf A");
    expect(payload!.venueName).toBe("Hall Alpha");
    expect(payload!.sessions).toHaveLength(1);
    expect(payload!.sessions[0]!.title).toBe("Opening");
    expect(payload!.sessions[0]!.items[0]!.title).toBe("A paper");
    expect(payload!.sessions[0]!.speakers[0]!.name).toBe("Dr. Public");
    expect(payload!.speakers.some((s) => s.name === "Dr. Public")).toBe(true);
    expect(payload!.sponsors[0]!.name).toBe("Acme");
    const json = JSON.stringify(payload);
    expect(json).not.toMatch(/@example\.com/);
    expect(json).not.toMatch(/password/i);
    expect(json).not.toMatch(/engagementPoints/);
  });

  it("does not bump slugInviteUseCount", async () => {
    if (!dbReady) return;
    await getPublicEventBySlug(ids.slugA!);
    await getPublicEventBySlug(ids.slugA!);
    const fresh = await prisma.event.findUniqueOrThrow({
      where: { id: ids.eventAId! },
      select: { slugInviteUseCount: true },
    });
    expect(fresh.slugInviteUseCount).toBe(useCountBefore);
  });

  it("returns null for DRAFT and ARCHIVED", async () => {
    if (!dbReady) return;
    const draft = await prisma.event.findUniqueOrThrow({ where: { id: ids.draftId! } });
    const archived = await prisma.event.findUniqueOrThrow({ where: { id: ids.archivedId! } });
    expect(await getPublicEventBySlug(draft.slug)).toBeNull();
    expect(await getPublicEventBySlug(archived.slug)).toBeNull();
  });

  it("tenancy: slug A payload is not event B", async () => {
    if (!dbReady) return;
    const a = await getPublicEventBySlug(ids.slugA!);
    const b = await getPublicEventBySlug(ids.slugB!);
    expect(a!.id).toBe(ids.eventAId);
    expect(b!.id).toBe(ids.eventBId);
    expect(a!.id).not.toBe(b!.id);
    expect(a!.sessions.every((s) => true)).toBe(true);
    expect(JSON.stringify(a)).not.toContain("Public Conf B");
    expect(JSON.stringify(b)).not.toContain("Public Conf A");
  });
});
