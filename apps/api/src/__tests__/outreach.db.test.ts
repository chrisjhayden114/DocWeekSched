/**
 * SPX-0 / SPX-1 — sponsor outreach pipeline + composer against the real routes.
 * Does NOT set ALLOW_DESTRUCTIVE_DB.
 *
 * Readyhall never sends these emails. This suite asserts the pipeline contract:
 * limit, import dedupe, CONTACTED stamps lastContactedAt, add-as-sponsor is
 * idempotent, template CRUD, OUTREACH_DRAFT metering, and the feature gate
 * 404s when outreach is off.
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
import { EventMemberRole, OrgRole, PrismaClient } from "@prisma/client";
import { PLAN_BY_SKU } from "@event-app/shared";
import { hashPassword, signToken } from "../lib/auth";
import { upsertFeatureOverrides } from "../lib/features";
import { assertOutreachProspectCap } from "../lib/billing/entitlements";
import { outreachRouter } from "../routes/outreach";
import { MockAiProvider, resetAiProviderForTests } from "../lib/ai";

type Prospect = {
  id: string;
  orgName: string;
  status: string;
  lastContactedAt?: string | null;
  sponsorId?: string | null;
  websiteUrl?: string | null;
  error?: string;
};

type DryRunBody = {
  rows?: { kind: string; rowIndex: number; orgName?: string; message?: string }[];
  summary?: { creates: number; errors: number; skipped: number };
  error?: string;
};

type ImportBody = {
  createdCount?: number;
  skippedCount?: number;
  created?: { id: string; orgName: string }[];
  skipped?: { orgName: string; reason: string }[];
  error?: string;
  upgrade?: { code: string; limitKey?: string; max?: number | null };
};

type AddSponsorBody = {
  prospect?: Prospect;
  sponsor?: { id: string; name: string; url?: string | null };
  created?: boolean;
  error?: string;
};

describe("sponsor outreach (DB, SPX-0)", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  const stamp = Date.now();
  const ids: {
    orgId?: string;
    freeOrgId?: string;
    eventId?: string;
    freeEventId?: string;
    adminId?: string;
  } = {};

  beforeAll(async () => {
    process.env.AI_PROVIDER = "mock";
    resetAiProviderForTests(new MockAiProvider());
    const passwordHash = await hashPassword("TestPass12!x");
    const admin = await prisma.user.create({
      data: {
        email: `spx-admin-${stamp}@example.com`,
        name: "Outreach Admin",
        role: "ADMIN",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    ids.adminId = admin.id;

    const org = await prisma.organization.create({
      data: {
        name: `Outreach Org ${stamp}`,
        slug: `spx-org-${stamp}`,
        plan: "PRO",
        eventAllowance: 5,
        memberships: { create: { userId: admin.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;

    const event = await prisma.event.create({
      data: {
        name: `Outreach Event ${stamp}`,
        slug: `spx-evt-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2027-09-01T09:00:00Z"),
        endDate: new Date("2027-09-02T17:00:00Z"),
        organizationId: org.id,
        createdById: admin.id,
        memberships: { create: { userId: admin.id, role: EventMemberRole.ADMIN } },
      },
    });
    ids.eventId = event.id;
    await upsertFeatureOverrides(event.id, { sponsors: true, sponsor_outreach: true });

    const freeOrg = await prisma.organization.create({
      data: {
        name: `Outreach Free ${stamp}`,
        slug: `spx-free-${stamp}`,
        plan: "FREE",
        memberships: { create: { userId: admin.id, role: OrgRole.OWNER } },
      },
    });
    ids.freeOrgId = freeOrg.id;
    const freeEvent = await prisma.event.create({
      data: {
        name: `Outreach Free Event ${stamp}`,
        slug: `spx-free-evt-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2027-09-01T09:00:00Z"),
        endDate: new Date("2027-09-02T17:00:00Z"),
        organizationId: freeOrg.id,
        createdById: admin.id,
        memberships: { create: { userId: admin.id, role: EventMemberRole.ADMIN } },
      },
    });
    ids.freeEventId = freeEvent.id;

    const app = express();
    app.use(express.json());
    app.use("/outreach", outreachRouter);
    app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const httpErr = err as { status?: number; body?: Record<string, unknown> };
      if (typeof httpErr?.status === "number" && httpErr.body) {
        return res.status(httpErr.status).json(httpErr.body);
      }
      return res.status(500).json({ error: "Internal server error" });
    });
    await new Promise<void>((resolveListen) => {
      server = app.listen(0, "127.0.0.1", resolveListen);
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    const eventIds = [ids.eventId, ids.freeEventId].filter((x): x is string => Boolean(x));
    if (eventIds.length > 0) {
      await prisma.sponsorProspect.deleteMany({ where: { eventId: { in: eventIds } } }).catch(() => null);
      await prisma.outreachTemplate.deleteMany({ where: { eventId: { in: eventIds } } }).catch(() => null);
      await prisma.sponsor.deleteMany({ where: { eventId: { in: eventIds } } }).catch(() => null);
      await prisma.eventFeatureConfig.deleteMany({ where: { eventId: { in: eventIds } } }).catch(() => null);
      await prisma.eventMembership.deleteMany({ where: { eventId: { in: eventIds } } }).catch(() => null);
      await prisma.event.deleteMany({ where: { id: { in: eventIds } } }).catch(() => null);
    }
    for (const orgId of [ids.orgId, ids.freeOrgId]) {
      if (!orgId) continue;
      await prisma.orgMembership.deleteMany({ where: { organizationId: orgId } }).catch(() => null);
      await prisma.organization.delete({ where: { id: orgId } }).catch(() => null);
    }
    if (ids.adminId) await prisma.user.delete({ where: { id: ids.adminId } }).catch(() => null);
    await prisma.$disconnect();
    if (server) {
      await new Promise<void>((resolveClose, reject) =>
        server.close((err) => (err ? reject(err) : resolveClose())),
      );
    }
  }, 60_000);

  function headers(eventId: string) {
    return {
      authorization: `Bearer ${signToken({ userId: ids.adminId!, role: "ADMIN" })}`,
      "content-type": "application/json",
      "x-event-id": eventId,
    };
  }

  async function create(body: Record<string, unknown>, eventId = ids.eventId!) {
    const res = await fetch(`${base}/outreach/prospects`, {
      method: "POST",
      headers: headers(eventId),
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Prospect };
  }

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch(`${base}/outreach/prospects/${id}`, {
      method: "PATCH",
      headers: headers(ids.eventId!),
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Prospect };
  }

  it("404s every write when sponsor_outreach is off", async () => {
    await upsertFeatureOverrides(ids.eventId!, { sponsors: true, sponsor_outreach: false });
    const created = await create({ orgName: "Should Not Land" });
    expect(created.status).toBe(404);
    expect(created.body.error).toMatch(/not available/i);
    expect(await prisma.sponsorProspect.count({ where: { eventId: ids.eventId } })).toBe(0);

    const templates = await fetch(`${base}/outreach/templates`, {
      method: "POST",
      headers: headers(ids.eventId!),
      body: JSON.stringify({ name: "Nope", subject: "Hi", body: "Hello" }),
    });
    expect(templates.status).toBe(404);
    const list = await fetch(`${base}/outreach/templates`, { headers: headers(ids.eventId!) });
    expect(list.status).toBe(404);
    expect(await prisma.outreachTemplate.count({ where: { eventId: ids.eventId } })).toBe(0);

    await upsertFeatureOverrides(ids.eventId!, { sponsors: true, sponsor_outreach: true });
  }, 60_000);

  it("stamps lastContactedAt only when moving to CONTACTED", async () => {
    const created = await create({ orgName: `Stamp Co ${stamp}` });
    expect(created.status).toBe(201);
    expect(created.body.lastContactedAt).toBeFalsy();

    const contacted = await patch(created.body.id, { status: "CONTACTED" });
    expect(contacted.status).toBe(200);
    expect(contacted.body.lastContactedAt).toBeTruthy();
    const firstStamp = contacted.body.lastContactedAt;

    const again = await patch(created.body.id, { status: "CONTACTED", notes: "pinged" });
    expect(again.body.lastContactedAt).toBe(firstStamp);

    const talking = await patch(created.body.id, { status: "IN_CONVERSATION" });
    expect(talking.body.lastContactedAt).toBe(firstStamp);
  }, 60_000);

  it("dry-run writes nothing; confirm dedupes by orgName", async () => {
    await create({ orgName: `Dupe Org ${stamp}` });
    const before = await prisma.sponsorProspect.count({ where: { eventId: ids.eventId } });

    const dryRes = await fetch(`${base}/outreach/prospects/import-dry-run`, {
      method: "POST",
      headers: headers(ids.eventId!),
      body: JSON.stringify({
        headers: ["org", "email"],
        rows: [
          { org: `Dupe Org ${stamp}`, email: "a@x.edu" },
          { org: `Fresh Org ${stamp}`, email: "b@x.edu" },
          { org: `Fresh Org ${stamp}`, email: "c@x.edu" },
        ],
      }),
    });
    const dry = (await dryRes.json()) as DryRunBody;
    expect(dryRes.status).toBe(200);
    expect(dry.summary?.creates).toBe(1);
    expect(dry.summary?.errors).toBe(2);
    expect(await prisma.sponsorProspect.count({ where: { eventId: ids.eventId } })).toBe(before);

    const confirmRes = await fetch(`${base}/outreach/prospects/import`, {
      method: "POST",
      headers: headers(ids.eventId!),
      body: JSON.stringify({
        prospects: [
          { orgName: `Dupe Org ${stamp}` },
          { orgName: `Fresh Org ${stamp}`, contactEmail: "b@x.edu" },
        ],
      }),
    });
    const imported = (await confirmRes.json()) as ImportBody;
    expect(confirmRes.status).toBe(200);
    expect(imported.createdCount).toBe(1);
    expect(imported.skippedCount).toBe(1);
    expect(imported.created?.[0]?.orgName).toBe(`Fresh Org ${stamp}`);
  }, 60_000);

  it("Add as sponsor is idempotent and does not duplicate the sponsor", async () => {
    const created = await create({
      orgName: `Convert Co ${stamp}`,
      websiteUrl: "https://convert.example.edu",
      status: "CONFIRMED",
    });
    expect(created.status).toBe(201);

    const first = await fetch(`${base}/outreach/prospects/${created.body.id}/add-as-sponsor`, {
      method: "POST",
      headers: headers(ids.eventId!),
    });
    const once = (await first.json()) as AddSponsorBody;
    expect(first.status).toBe(200);
    expect(once.created).toBe(true);
    expect(once.sponsor?.name).toBe(`Convert Co ${stamp}`);
    expect(once.sponsor?.url).toBe("https://convert.example.edu/");
    expect(once.prospect?.sponsorId).toBe(once.sponsor?.id);

    const second = await fetch(`${base}/outreach/prospects/${created.body.id}/add-as-sponsor`, {
      method: "POST",
      headers: headers(ids.eventId!),
    });
    const twice = (await second.json()) as AddSponsorBody;
    expect(second.status).toBe(200);
    expect(twice.created).toBe(false);
    expect(twice.sponsor?.id).toBe(once.sponsor?.id);
    expect(await prisma.sponsor.count({ where: { eventId: ids.eventId, name: `Convert Co ${stamp}` } })).toBe(
      1,
    );
  }, 60_000);

  it("enforces the Free outreachProspectsPerEvent cap before writing", async () => {
    const cap = PLAN_BY_SKU.free.limits.outreachProspectsPerEvent!;
    const eventId = ids.freeEventId!;
    const orgId = ids.freeOrgId!;
    for (let i = 0; i < cap; i += 1) {
      await prisma.sponsorProspect.create({
        data: { eventId, orgName: `Cap ${i + 1} ${stamp}` },
      });
    }
    await expect(assertOutreachProspectCap(eventId, orgId, 1)).rejects.toMatchObject({
      status: 402,
      body: {
        upgrade: {
          code: "PLAN_LIMIT",
          limitKey: "outreachProspectsPerEvent",
          current: cap,
          max: cap,
        },
      },
    });
    expect(await prisma.sponsorProspect.count({ where: { eventId } })).toBe(cap);
  }, 60_000);

  it("templates CRUD does not seed a starter row", async () => {
    const listed = await fetch(`${base}/outreach/templates`, { headers: headers(ids.eventId!) });
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual([]);

    const created = await fetch(`${base}/outreach/templates`, {
      method: "POST",
      headers: headers(ids.eventId!),
      body: JSON.stringify({
        name: "Ask",
        subject: "Would {orgName} help {eventName}?",
        body: "Hello {contactName}",
      }),
    });
    expect(created.status).toBe(201);
    const row = (await created.json()) as { id: string; subject: string };
    expect(row.subject).toContain("{orgName}");

    const patched = await fetch(`${base}/outreach/templates/${row.id}`, {
      method: "PATCH",
      headers: headers(ids.eventId!),
      body: JSON.stringify({ name: "Ask v2" }),
    });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { name: string }).name).toBe("Ask v2");

    const del = await fetch(`${base}/outreach/templates/${row.id}`, {
      method: "DELETE",
      headers: headers(ids.eventId!),
    });
    expect(del.status).toBe(200);
    expect(await prisma.outreachTemplate.count({ where: { eventId: ids.eventId } })).toBe(0);
  }, 60_000);

  it("OUTREACH_DRAFT is metered and 404s when the gate is off", async () => {
    resetAiProviderForTests(new MockAiProvider());
    const prospect = await create({
      orgName: `Draft Co ${stamp}`,
      contactName: "Jordan",
      contactEmail: "j@draft.example",
    });
    expect(prospect.status).toBe(201);

    const before = await prisma.aiUsageRecord.count({
      where: { eventId: ids.eventId, feature: "OUTREACH_DRAFT" },
    });
    const drafted = await fetch(`${base}/outreach/prospects/${prospect.body.id}/draft`, {
      method: "POST",
      headers: headers(ids.eventId!),
    });
    expect(drafted.status).toBe(200);
    const body = (await drafted.json()) as { subject?: string; body?: string; aiGenerated?: boolean };
    expect(body.subject).toBeTruthy();
    expect(body.body).toBeTruthy();
    expect(body.aiGenerated).toBe(true);
    expect(await prisma.aiUsageRecord.count({
      where: { eventId: ids.eventId, feature: "OUTREACH_DRAFT" },
    })).toBe(before + 1);

    await upsertFeatureOverrides(ids.eventId!, { sponsors: true, sponsor_outreach: false });
    const blocked = await fetch(`${base}/outreach/prospects/${prospect.body.id}/draft`, {
      method: "POST",
      headers: headers(ids.eventId!),
    });
    expect(blocked.status).toBe(404);
    await upsertFeatureOverrides(ids.eventId!, { sponsors: true, sponsor_outreach: true });
  }, 60_000);
});
