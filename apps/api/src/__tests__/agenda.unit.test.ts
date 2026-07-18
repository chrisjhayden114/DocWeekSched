import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "crypto";
import { EventMemberRole, EventStatus, OrgRole, PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/auth";
import { newJoinToken } from "../lib/inviteTokens";

/** Inline copy of web agenda filter helpers for API unit tests. */
type S = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  trackId?: string | null;
  roomId?: string | null;
  speakers?: string | null;
  items?: Array<{ title: string; authors?: Array<{ name: string }> }>;
};

function blob(s: S) {
  return [s.title, s.speakers, ...(s.items || []).flatMap((i) => [i.title, ...(i.authors || []).map((a) => a.name)])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function filterSessions(sessions: S[], q: string, trackId: string | null) {
  const query = q.trim().toLowerCase();
  return sessions.filter((s) => {
    if (trackId && s.trackId !== trackId) return false;
    if (query && !blob(s).includes(query)) return false;
    return true;
  });
}

function overlaps(sessions: S[]) {
  const out = new Set<string>();
  for (let i = 0; i < sessions.length; i++) {
    for (let j = i + 1; j < sessions.length; j++) {
      const a = sessions[i];
      const b = sessions[j];
      if (new Date(a.startsAt) < new Date(b.endsAt) && new Date(b.startsAt) < new Date(a.endsAt)) {
        out.add(a.id);
        out.add(b.id);
      }
    }
  }
  return out;
}

describe("agenda filter helpers", () => {
  const sessions: S[] = [
    {
      id: "1",
      title: "Opening",
      startsAt: "2027-06-01T14:00:00Z",
      endsAt: "2027-06-01T15:00:00Z",
      trackId: "t1",
      items: [{ title: "Welcome", authors: [{ name: "Ada" }] }],
    },
    {
      id: "2",
      title: "Workshop",
      startsAt: "2027-06-01T14:30:00Z",
      endsAt: "2027-06-01T16:00:00Z",
      trackId: "t2",
      speakers: "Grace",
    },
  ];

  it("filters by track and full-text", () => {
    expect(filterSessions(sessions, "", "t1").map((s) => s.id)).toEqual(["1"]);
    expect(filterSessions(sessions, "ada", null).map((s) => s.id)).toEqual(["1"]);
    expect(filterSessions(sessions, "grace", null).map((s) => s.id)).toEqual(["2"]);
  });

  it("detects overlapping sessions", () => {
    expect([...overlaps(sessions)].sort()).toEqual(["1", "2"]);
  });
});

describe("ICS token lookup (DB)", () => {
  const prisma = new PrismaClient();
  const ids: { orgId?: string; eventId?: string; userId?: string } = {};
  let dbReady = false;

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await prisma.icsFeedToken.findFirst();
    } catch {
      console.warn("[ics.db.test] DB unreachable — skipping");
      return;
    }
    dbReady = true;
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
    if (!dbReady) return;
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
