/**
 * ORG-1 — PUT /organizations/:orgId against a real database.
 *
 * Three things are pinned here that the unit test cannot see: the role gate
 * (STAFF may read the organization but never rename it), that the patchFields
 * contract survives the round trip to Postgres, and that a rejected save
 * leaves the row exactly as it was.
 *
 * The fourth is the payoff: the organization's website and support email reach
 * the public event payload, and its logo stands in for an event that never
 * uploaded one — without ever being written onto the event row.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "fs";
import { resolve } from "path";
import dotenv from "dotenv";

for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
  if (existsSync(p)) dotenv.config({ path: p });
}

import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { EventStatus, OrgRole, PrismaClient } from "@prisma/client";
import { hashPassword, signToken } from "../lib/auth";
import { organizationsRouter } from "../routes/organizations";
import { getPublicEventBySlug } from "../lib/publicEvent";

type OrgBody = {
  id: string;
  name: string;
  slug: string;
  websiteUrl: string | null;
  supportEmail: string | null;
  logoUrl: string | null;
  description: string | null;
  role?: string;
  error?: string;
  details?: Record<string, string[]>;
};

const ORG_LOGO = "https://cdn.example.com/org-crest.png";
const EVENT_LOGO = "https://cdn.example.com/event-mark.png";

describe("PUT /organizations/:orgId (DB)", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  const ids: { orgId?: string; ownerId?: string; staffId?: string; outsiderId?: string } = {};

  beforeAll(async () => {
    const passwordHash = await hashPassword("TestPass12!x");
    const stamp = Date.now();

    const makeUser = (label: string) =>
      prisma.user.create({
        data: {
          email: `org1-${label}-${stamp}@example.com`,
          name: `Org1 ${label}`,
          role: "ADMIN",
          passwordHash,
          emailVerifiedAt: new Date(),
        },
      });

    const owner = await makeUser("owner");
    const staff = await makeUser("staff");
    const outsider = await makeUser("outsider");
    ids.ownerId = owner.id;
    ids.staffId = staff.id;
    ids.outsiderId = outsider.id;

    const org = await prisma.organization.create({
      data: {
        name: `Northbridge ${stamp}`,
        slug: `org1-org-${stamp}`,
        plan: "PRO",
        eventAllowance: 5,
        memberships: {
          create: [
            { userId: owner.id, role: OrgRole.OWNER },
            { userId: staff.id, role: OrgRole.STAFF },
          ],
        },
      },
    });
    ids.orgId = org.id;

    const app = express();
    app.use(express.json());
    app.use("/organizations", organizationsRouter);
    app.use(
      (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        const httpErr = err as { status?: number; body?: Record<string, unknown> };
        if (typeof httpErr?.status === "number" && httpErr.body) {
          return res.status(httpErr.status).json(httpErr.body);
        }
        return res.status(500).json({ error: "Internal server error" });
      },
    );
    await new Promise<void>((resolveListen) => {
      server = app.listen(0, "127.0.0.1", resolveListen);
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    if (ids.orgId) {
      await prisma.auditLog.deleteMany({ where: { organizationId: ids.orgId } }).catch(() => null);
      await prisma.orgMembership
        .deleteMany({ where: { organizationId: ids.orgId } })
        .catch(() => null);
      await prisma.organization.delete({ where: { id: ids.orgId } }).catch(() => null);
    }
    for (const userId of [ids.ownerId, ids.staffId, ids.outsiderId]) {
      if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => null);
    }
    await prisma.$disconnect();
    if (server) {
      await new Promise<void>((resolveClose, reject) =>
        server.close((err) => (err ? reject(err) : resolveClose())),
      );
    }
  }, 60_000);

  function authHeader(userId: string) {
    return `Bearer ${signToken({ userId, role: "ADMIN" })}`;
  }

  async function put(userId: string, body: Record<string, unknown>) {
    const res = await fetch(`${base}/organizations/${ids.orgId}`, {
      method: "PUT",
      headers: {
        authorization: authHeader(userId),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as OrgBody };
  }

  async function get(userId: string) {
    const res = await fetch(`${base}/organizations/${ids.orgId}`, {
      headers: { authorization: authHeader(userId) },
    });
    return { status: res.status, body: (await res.json()) as OrgBody };
  }

  async function stored() {
    return prisma.organization.findUniqueOrThrow({
      where: { id: ids.orgId! },
      select: {
        name: true,
        slug: true,
        websiteUrl: true,
        supportEmail: true,
        logoUrl: true,
        description: true,
        plan: true,
      },
    });
  }

  /** A fully filled-in organization, so each case stands alone. */
  async function seedIdentity() {
    await prisma.organization.update({
      where: { id: ids.orgId! },
      data: {
        name: "Northbridge Schools",
        websiteUrl: "https://northbridge.edu",
        supportEmail: "events@northbridge.edu",
        logoUrl: ORG_LOGO,
        description: "District PD team.",
      },
    });
  }

  it("the name is editable at last, and nothing else moves with it", async () => {
    await seedIdentity();

    const res = await put(ids.ownerId!, { name: "Northbridge Unified" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Northbridge Unified");

    // The response and the row must agree — a caller that trusts the response
    // would otherwise re-save the nulls it was handed.
    expect(res.body.websiteUrl).toBe("https://northbridge.edu");
    expect(res.body.logoUrl).toBe(ORG_LOGO);
    expect(await stored()).toMatchObject({
      name: "Northbridge Unified",
      websiteUrl: "https://northbridge.edu",
      supportEmail: "events@northbridge.edu",
      logoUrl: ORG_LOGO,
      description: "District PD team.",
    });
  }, 60_000);

  it("an explicit null clears exactly the field it names", async () => {
    await seedIdentity();

    const one = await put(ids.ownerId!, { websiteUrl: null });
    expect(one.status).toBe(200);
    expect(await stored()).toMatchObject({
      websiteUrl: null,
      supportEmail: "events@northbridge.edu",
      logoUrl: ORG_LOGO,
    });

    const rest = await put(ids.ownerId!, { supportEmail: null, logoUrl: null, description: null });
    expect(rest.status).toBe(200);
    expect(await stored()).toMatchObject({
      websiteUrl: null,
      supportEmail: null,
      logoUrl: null,
      description: null,
      name: "Northbridge Schools",
    });
  }, 60_000);

  it("an emptied text box clears, and a bare domain is stored as https", async () => {
    await seedIdentity();

    const res = await put(ids.ownerId!, {
      name: "Northbridge Schools",
      websiteUrl: "northbridge.edu/pd",
      supportEmail: "  ",
      description: "",
    });
    expect(res.status).toBe(200);
    expect(await stored()).toMatchObject({
      websiteUrl: "https://northbridge.edu/pd",
      supportEmail: null,
      description: null,
      logoUrl: ORG_LOGO,
    });
  }, 60_000);

  it("STAFF may read the organization but gets a 403 on any save", async () => {
    await seedIdentity();
    const before = await stored();

    const read = await get(ids.staffId!);
    expect(read.status).toBe(200);
    expect(read.body.role).toBe("STAFF");
    expect(read.body.name).toBe("Northbridge Schools");

    const write = await put(ids.staffId!, { name: "Renamed By Staff" });
    expect(write.status).toBe(403);
    expect(await stored()).toEqual(before);
  }, 60_000);

  it("a non-member sees nothing and changes nothing", async () => {
    await seedIdentity();
    const before = await stored();

    expect((await get(ids.outsiderId!)).status).toBe(403);
    expect((await put(ids.outsiderId!, { name: "Hijacked" })).status).toBe(403);
    expect(await stored()).toEqual(before);
  }, 60_000);

  it("refuses a blank name, a hostile website, and a broken email — changing nothing", async () => {
    await seedIdentity();
    const before = await stored();

    expect((await put(ids.ownerId!, { name: "   " })).status).toBe(400);
    expect((await put(ids.ownerId!, { websiteUrl: "javascript:alert(1)" })).status).toBe(400);
    expect((await put(ids.ownerId!, { supportEmail: "not-an-address" })).status).toBe(400);
    expect(await stored()).toEqual(before);
  }, 60_000);

  it("cannot touch the slug or the plan, whatever the body carries", async () => {
    await seedIdentity();
    const before = await stored();

    const res = await put(ids.ownerId!, {
      name: "Northbridge Schools",
      slug: "somebody-elses-slug",
      plan: "FREE",
      eventAllowance: 9999,
    });
    expect(res.status).toBe(200);
    expect(await stored()).toEqual(before);
  }, 60_000);

  it("records the save in the audit log, naming only the fields that moved", async () => {
    await seedIdentity();
    await prisma.auditLog.deleteMany({ where: { organizationId: ids.orgId! } });

    await put(ids.ownerId!, { name: "Northbridge Audited" });
    const row = await prisma.auditLog.findFirstOrThrow({
      where: { organizationId: ids.orgId!, entityType: "Organization" },
      orderBy: { createdAt: "desc" },
    });
    expect(row.actorUserId).toBe(ids.ownerId);
    expect(row.payload).toMatchObject({ action: "org_identity_saved", fields: ["name"] });
  }, 60_000);
});

describe("ORG-1 on the public event payload (DB)", () => {
  const prisma = new PrismaClient();
  const ids: { orgId?: string; ownerId?: string; ownEventId?: string; bareEventId?: string } = {};
  let ownSlug = "";
  let bareSlug = "";

  beforeAll(async () => {
    const passwordHash = await hashPassword("TestPass12!x");
    const stamp = `${Date.now()}p`;

    const owner = await prisma.user.create({
      data: {
        email: `org1-public-${stamp}@example.com`,
        name: "Org1 Public Owner",
        role: "ADMIN",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    ids.ownerId = owner.id;

    const org = await prisma.organization.create({
      data: {
        name: "Northbridge Schools",
        slug: `org1-public-org-${stamp}`,
        plan: "PRO",
        eventAllowance: 5,
        websiteUrl: "https://northbridge.edu",
        supportEmail: "events@northbridge.edu",
        logoUrl: ORG_LOGO,
        description: "Never public.",
        memberships: { create: [{ userId: owner.id, role: OrgRole.OWNER }] },
      },
    });
    ids.orgId = org.id;

    ownSlug = `org1-public-own-${stamp}`;
    bareSlug = `org1-public-bare-${stamp}`;
    const defaults = {
      timezone: "UTC",
      startDate: new Date("2027-05-04T09:00:00Z"),
      endDate: new Date("2027-05-05T17:00:00Z"),
      status: EventStatus.ACTIVE,
      organizationId: org.id,
      createdById: owner.id,
    };

    ids.ownEventId = (
      await prisma.event.create({
        data: { ...defaults, name: "Own Logo", slug: ownSlug, logoUrl: EVENT_LOGO },
      })
    ).id;
    ids.bareEventId = (
      await prisma.event.create({
        data: { ...defaults, name: "No Logo", slug: bareSlug, logoUrl: null },
      })
    ).id;
  }, 60_000);

  afterAll(async () => {
    for (const eventId of [ids.ownEventId, ids.bareEventId]) {
      if (!eventId) continue;
      await prisma.eventMembership.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.event.delete({ where: { id: eventId } }).catch(() => null);
    }
    if (ids.orgId) {
      await prisma.orgMembership
        .deleteMany({ where: { organizationId: ids.orgId } })
        .catch(() => null);
      await prisma.organization.delete({ where: { id: ids.orgId } }).catch(() => null);
    }
    if (ids.ownerId) await prisma.user.delete({ where: { id: ids.ownerId } }).catch(() => null);
    await prisma.$disconnect();
  }, 60_000);

  it("carries the host's website and support email, so hosted-by can link and contact", async () => {
    const payload = await getPublicEventBySlug(bareSlug);
    expect(payload?.organizationName).toBe("Northbridge Schools");
    expect(payload?.organizationWebsiteUrl).toBe("https://northbridge.edu");
    expect(payload?.organizationSupportEmail).toBe("events@northbridge.edu");
  }, 60_000);

  it("never publishes the organization's description — identity, not billboard", async () => {
    const payload = await getPublicEventBySlug(bareSlug);
    expect(JSON.stringify(payload)).not.toContain("Never public.");
  }, 60_000);

  it("an event with no logo of its own renders the organization's", async () => {
    const payload = await getPublicEventBySlug(bareSlug);
    expect(payload?.logoUrl).toBeNull();
    expect(payload?.displayLogoUrl).toBe(ORG_LOGO);
  }, 60_000);

  it("an event that chose its own logo keeps it, and the row is never rewritten", async () => {
    const payload = await getPublicEventBySlug(ownSlug);
    expect(payload?.logoUrl).toBe(EVENT_LOGO);
    expect(payload?.displayLogoUrl).toBe(EVENT_LOGO);

    // The fallback is read-time only: no event row ever holds the org's logo.
    const rows = await prisma.event.findMany({
      where: { organizationId: ids.orgId! },
      select: { logoUrl: true },
    });
    expect(rows.map((r) => r.logoUrl).sort()).toEqual([EVENT_LOGO, null]);
  }, 60_000);
});
