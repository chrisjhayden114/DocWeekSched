/**
 * ORG-2 — the organization lifecycle against a real database.
 *
 * Six things are pinned here, and the reason each one needs Postgres rather
 * than a unit test:
 *
 * 1. promote-then-transfer actually swaps two membership rows, atomically.
 * 2. a STAFF target is refused, so the promote step cannot be skipped.
 * 3. a close refusal itemizes every reason at once, not the first one hit.
 * 4. a close succeeds when the org is empty — and the sole-OWNER account
 *    deletion guard stops counting it, which is the dead end ORG-2 exists to
 *    remove.
 * 5. a draft transfer rewrites EVERY table that denormalizes organizationId.
 *    This is the payoff: the test seeds a row in each of the fourteen child
 *    tables and then asserts no row anywhere still points at the old org.
 *    Two of those tables have no foreign key, so nothing but this check would
 *    have noticed.
 * 6. a published event is refused with its reasons and the honest alternative.
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
import { eventRouter } from "../routes/event";
import { EVENT_ORGANIZATION_CHILD_TABLES } from "../lib/orgLifecycle";
import { findSoleOwnerOrgIds } from "../lib/accountDeletion";

type Json = Record<string, unknown>;

describe("ORG-2 organization lifecycle (DB)", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  const stamp = Date.now();

  const ids: {
    ownerId?: string;
    adminId?: string;
    staffId?: string;
    orgAId?: string;
    orgBId?: string;
    /** Org kept deliberately dirty, to exercise the itemized refusal. */
    orgDirtyId?: string;
    draftEventId?: string;
    publishedEventId?: string;
    speakerId?: string;
    requirementId?: string;
  } = {};

  beforeAll(async () => {
    const passwordHash = await hashPassword("TestPass12!x");
    const makeUser = (label: string) =>
      prisma.user.create({
        data: {
          email: `org2-${label}-${stamp}@example.com`,
          name: `Org2 ${label}`,
          role: "ADMIN",
          passwordHash,
          emailVerifiedAt: new Date(),
        },
      });

    const [owner, admin, staff] = await Promise.all([
      makeUser("owner"),
      makeUser("admin"),
      makeUser("staff"),
    ]);
    ids.ownerId = owner.id;
    ids.adminId = admin.id;
    ids.staffId = staff.id;

    // eventAllowance null = unlimited, so plan limits never stand in for the
    // eligibility rules this suite is actually testing.
    const makeOrg = (label: string, memberships: { userId: string; role: OrgRole }[]) =>
      prisma.organization.create({
        data: {
          name: `Org2 ${label} ${stamp}`,
          slug: `org2-${label}-${stamp}`,
          plan: "PRO",
          eventAllowance: null,
          memberships: { create: memberships },
        },
      });

    const orgA = await makeOrg("source", [
      { userId: owner.id, role: OrgRole.OWNER },
      { userId: admin.id, role: OrgRole.ADMIN },
      { userId: staff.id, role: OrgRole.STAFF },
    ]);
    const orgB = await makeOrg("destination", [{ userId: owner.id, role: OrgRole.OWNER }]);
    const orgDirty = await makeOrg("dirty", [{ userId: owner.id, role: OrgRole.OWNER }]);
    ids.orgAId = orgA.id;
    ids.orgBId = orgB.id;
    ids.orgDirtyId = orgDirty.id;

    const eventDefaults = {
      timezone: "UTC",
      startDate: new Date("2027-05-04T09:00:00Z"),
      endDate: new Date("2027-05-05T17:00:00Z"),
      createdById: owner.id,
    };

    const draft = await prisma.event.create({
      data: {
        ...eventDefaults,
        name: "Org2 Draft",
        slug: `org2-draft-${stamp}`,
        status: EventStatus.DRAFT,
        organizationId: orgA.id,
      },
    });
    ids.draftEventId = draft.id;

    const published = await prisma.event.create({
      data: {
        ...eventDefaults,
        name: "Org2 Published",
        slug: `org2-published-${stamp}`,
        status: EventStatus.ACTIVE,
        organizationId: orgDirty.id,
      },
    });
    ids.publishedEventId = published.id;

    // One row in every child table that denormalizes organizationId, so the
    // transfer has something to miss.
    const speaker = await prisma.speaker.create({
      data: { eventId: draft.id, name: "Org2 Speaker" },
    });
    ids.speakerId = speaker.id;

    const readinessTemplate = await prisma.readinessTemplate.create({
      data: { organizationId: orgA.id, eventId: draft.id, name: "Org2 Pack" },
    });
    const requirement = await prisma.readinessRequirement.create({
      data: {
        templateId: readinessTemplate.id,
        eventId: draft.id,
        label: "Headshot",
        kind: "confirm",
      },
    });
    ids.requirementId = requirement.id;

    await Promise.all([
      prisma.eventPurchase.create({
        data: {
          organizationId: orgA.id,
          eventId: draft.id,
          plan: "PER_EVENT",
          amountCents: 0,
          attendeeCap: 100,
          status: "FAILED",
        },
      }),
      prisma.adminAccessRequest.create({
        data: { organizationId: orgA.id, eventId: draft.id, userId: ids.adminId! },
      }),
      prisma.aiUsageRecord.create({
        data: {
          organizationId: orgA.id,
          eventId: draft.id,
          feature: "SETUP_COPILOT",
          provider: "test",
          model: "test",
        },
      }),
      prisma.auditLog.create({
        data: { organizationId: orgA.id, eventId: draft.id, action: "OTHER" },
      }),
      prisma.backgroundJob.create({
        data: { organizationId: orgA.id, eventId: draft.id, type: "org2.test", status: "DEAD" },
      }),
      prisma.agendaIngestRun.create({
        data: { organizationId: orgA.id, eventId: draft.id, status: "FAILED", sourceKind: "CSV" },
      }),
      prisma.opsInboxCard.create({
        data: {
          organizationId: orgA.id,
          eventId: draft.id,
          detectorKind: "MODERATION",
          triggerInstanceKey: `org2-trigger-${stamp}`,
          triggerSummary: "Seeded for the ORG-2 transfer test",
          draftActionType: "MODERATION_REVIEW",
          draftTitle: "Org2 card",
          draftBody: "seed",
        },
      }),
      prisma.badgeTemplate.create({
        data: { organizationId: orgA.id, eventId: draft.id },
      }),
      prisma.certificateTemplate.create({
        data: {
          organizationId: orgA.id,
          eventId: draft.id,
          name: "Org2 Attendance",
          titleText: "Certificate of Attendance",
          eligibilityRule: "ANY_CHECKIN",
        },
      }),
      prisma.eventRecap.create({
        data: { organizationId: orgA.id, eventId: draft.id },
      }),
      prisma.readinessPortalAccess.create({
        data: {
          organizationId: orgA.id,
          eventId: draft.id,
          speakerId: speaker.id,
          email: `org2-portal-${stamp}@example.com`,
          tokenHash: `org2-token-${stamp}`,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      }),
    ]);

    await prisma.readinessAssignment.create({
      data: {
        organizationId: orgA.id,
        eventId: draft.id,
        requirementId: requirement.id,
        speakerId: speaker.id,
      },
    });

    // IssuedCertificate would disqualify the draft, so it belongs to the dirty
    // org's published event instead — where it is one of the close blockers.
    const dirtyCertTemplate = await prisma.certificateTemplate.create({
      data: {
        organizationId: orgDirty.id,
        eventId: published.id,
        name: "Org2 Dirty Attendance",
        titleText: "Certificate of Attendance",
        eligibilityRule: "ANY_CHECKIN",
      },
    });
    await prisma.issuedCertificate.create({
      data: {
        organizationId: orgDirty.id,
        eventId: published.id,
        certificateTemplateId: dirtyCertTemplate.id,
        userId: ids.adminId!,
        publicId: `org2-cert-${stamp}`,
        attendeeNameSnapshot: "Org2 Attendee",
        eventNameSnapshot: "Org2 Published",
        eventDateSnapshot: new Date("2027-05-04T09:00:00Z"),
        issuedAt: new Date(),
      },
    });
    await prisma.aiUsageRecord.create({
      data: {
        organizationId: orgDirty.id,
        eventId: published.id,
        feature: "RECAP",
        provider: "test",
        model: "test",
      },
    });

    const app = express();
    app.use(express.json({ limit: "20mb" }));
    app.use("/organizations", organizationsRouter);
    app.use("/event", eventRouter);
    app.use(
      (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        const httpErr = err as { status?: number; body?: Record<string, unknown> };
        if (typeof httpErr?.status === "number" && httpErr.body) {
          return res.status(httpErr.status).json(httpErr.body);
        }
        return res.status(500).json({ error: "Internal server error" });
      },
    );
    await new Promise<void>((ready) => {
      server = app.listen(0, "127.0.0.1", ready);
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 120_000);

  afterAll(async () => {
    const eventIds = [ids.draftEventId, ids.publishedEventId].filter(Boolean) as string[];
    const orgIds = [ids.orgAId, ids.orgBId, ids.orgDirtyId].filter(Boolean) as string[];

    for (const eventId of eventIds) {
      await prisma.readinessAssignment.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.readinessPortalAccess.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.readinessTemplate.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.issuedCertificate.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.certificateTemplate.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.badgeTemplate.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.eventRecap.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.opsInboxCard.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.agendaIngestRun.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.backgroundJob.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.auditLog.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.aiUsageRecord.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.adminAccessRequest.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.eventPurchase.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.speaker.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.eventMembership.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.event.delete({ where: { id: eventId } }).catch(() => null);
    }
    for (const orgId of orgIds) {
      await prisma.auditLog.deleteMany({ where: { organizationId: orgId } }).catch(() => null);
      await prisma.backgroundJob.deleteMany({ where: { organizationId: orgId } }).catch(() => null);
      await prisma.aiUsageRecord.deleteMany({ where: { organizationId: orgId } }).catch(() => null);
      await prisma.eventPurchase.deleteMany({ where: { organizationId: orgId } }).catch(() => null);
      await prisma.orgMembership.deleteMany({ where: { organizationId: orgId } }).catch(() => null);
      await prisma.organization.delete({ where: { id: orgId } }).catch(() => null);
    }
    for (const userId of [ids.ownerId, ids.adminId, ids.staffId]) {
      if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => null);
    }
    await prisma.$disconnect();
    if (server) {
      await new Promise<void>((done, reject) =>
        server.close((err) => (err ? reject(err) : done())),
      );
    }
  }, 120_000);

  function auth(userId: string) {
    return `Bearer ${signToken({ userId, role: "ADMIN" })}`;
  }

  async function call(
    method: "GET" | "POST",
    path: string,
    userId: string,
    opts: { body?: Json; eventId?: string } = {},
  ) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: auth(userId),
        "content-type": "application/json",
        ...(opts.eventId ? { "x-event-id": opts.eventId } : {}),
      },
      ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
    });
    return { status: res.status, body: (await res.json()) as Json };
  }

  async function roleOf(orgId: string, userId: string) {
    const row = await prisma.orgMembership.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
      select: { role: true },
    });
    return row?.role ?? null;
  }

  /* ---------------------------------------------------------------- *
   * 1 + 2 — transfer ownership
   * ---------------------------------------------------------------- */

  it("refuses a STAFF target, so promote-then-transfer cannot be short-circuited", async () => {
    const res = await call("POST", `/organizations/${ids.orgAId}/transfer-ownership`, ids.ownerId!, {
      body: { newOwnerUserId: ids.staffId! },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("TARGET_NOT_ADMIN");
    expect(String(res.body.error)).toMatch(/promote them to admin first/i);

    // Nothing moved.
    expect(await roleOf(ids.orgAId!, ids.ownerId!)).toBe(OrgRole.OWNER);
    expect(await roleOf(ids.orgAId!, ids.staffId!)).toBe(OrgRole.STAFF);
  }, 60_000);

  it("refuses a non-member, a non-owner caller, and the owner themselves", async () => {
    const outsider = await call(
      "POST",
      `/organizations/${ids.orgBId}/transfer-ownership`,
      ids.ownerId!,
      { body: { newOwnerUserId: ids.adminId! } },
    );
    expect(outsider.status).toBe(404);
    expect(outsider.body.code).toBe("TARGET_NOT_MEMBER");

    // An ADMIN may edit the org's identity but may not give it away.
    const byAdmin = await call(
      "POST",
      `/organizations/${ids.orgAId}/transfer-ownership`,
      ids.adminId!,
      { body: { newOwnerUserId: ids.adminId! } },
    );
    expect(byAdmin.status).toBe(403);

    const toSelf = await call(
      "POST",
      `/organizations/${ids.orgAId}/transfer-ownership`,
      ids.ownerId!,
      { body: { newOwnerUserId: ids.ownerId! } },
    );
    expect(toSelf.status).toBe(400);
    expect(toSelf.body.code).toBe("TRANSFER_TO_SELF");
  }, 60_000);

  it("hands the organization to an ADMIN, demotes the old owner, and says so in the audit log", async () => {
    const members = await call("GET", `/organizations/${ids.orgAId}/members`, ids.ownerId!);
    expect(members.status).toBe(200);
    expect(members.body.transferTargetRole).toBe("ADMIN");

    const res = await call("POST", `/organizations/${ids.orgAId}/transfer-ownership`, ids.ownerId!, {
      body: { newOwnerUserId: ids.adminId! },
    });
    expect(res.status).toBe(200);
    expect(res.body.yourRole).toBe(OrgRole.ADMIN);

    // Exactly one owner, and it is the new one.
    expect(await roleOf(ids.orgAId!, ids.adminId!)).toBe(OrgRole.OWNER);
    expect(await roleOf(ids.orgAId!, ids.ownerId!)).toBe(OrgRole.ADMIN);
    expect(
      await prisma.orgMembership.count({
        where: { organizationId: ids.orgAId!, role: OrgRole.OWNER },
      }),
    ).toBe(1);

    const row = await prisma.auditLog.findFirstOrThrow({
      where: { organizationId: ids.orgAId!, entityType: "Organization" },
      orderBy: { createdAt: "desc" },
    });
    expect(row.actorUserId).toBe(ids.ownerId);
    expect(row.payload).toMatchObject({
      action: "org_ownership_transferred",
      newOwnerUserId: ids.adminId,
    });

    // The former owner can no longer transfer or close it.
    const again = await call(
      "POST",
      `/organizations/${ids.orgAId}/transfer-ownership`,
      ids.ownerId!,
      { body: { newOwnerUserId: ids.adminId! } },
    );
    expect(again.status).toBe(403);

    // Hand it back, so the transfer cases don't dictate the order of the rest.
    const back = await call(
      "POST",
      `/organizations/${ids.orgAId}/transfer-ownership`,
      ids.adminId!,
      { body: { newOwnerUserId: ids.ownerId! } },
    );
    expect(back.status).toBe(200);
    expect(await roleOf(ids.orgAId!, ids.ownerId!)).toBe(OrgRole.OWNER);
  }, 60_000);

  /* ---------------------------------------------------------------- *
   * 3 + 4 — close
   * ---------------------------------------------------------------- */

  it("refuses to close a dirty organization and itemizes every reason at once", async () => {
    const pre = await call("GET", `/organizations/${ids.orgDirtyId}/close`, ids.ownerId!);
    expect(pre.status).toBe(200);
    expect(pre.body.canClose).toBe(false);
    const kinds = (pre.body.blockers as Array<{ kind: string }>).map((b) => b.kind).sort();
    expect(kinds).toEqual(["AI_USAGE", "CERTIFICATES", "PUBLISHED_EVENTS"]);

    const reasons = pre.body.reasons as string[];
    expect(reasons).toHaveLength(3);
    // The published event is named, not just counted.
    expect(reasons.join(" ")).toContain("Org2 Published");

    const res = await call("POST", `/organizations/${ids.orgDirtyId}/close`, ids.ownerId!, {
      body: { confirmName: `Org2 dirty ${stamp}` },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ORG_NOT_EMPTY");
    expect((res.body.reasons as string[]).length).toBe(3);

    expect(
      (await prisma.organization.findUniqueOrThrow({ where: { id: ids.orgDirtyId! } })).closedAt,
    ).toBeNull();
  }, 60_000);

  it("refuses to close on a mistyped name, however empty the organization is", async () => {
    const res = await call("POST", `/organizations/${ids.orgBId}/close`, ids.ownerId!, {
      body: { confirmName: "not the name" },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("CONFIRM_NAME_MISMATCH");
    expect(
      (await prisma.organization.findUniqueOrThrow({ where: { id: ids.orgBId! } })).closedAt,
    ).toBeNull();
  }, 60_000);

  it("closes an empty organization, and that releases the account-deletion dead end", async () => {
    // Before: the owner is the only owner of three orgs, so deletion is blocked.
    const blockedBefore = await findSoleOwnerOrgIds(ids.ownerId!);
    expect(blockedBefore).toContain(ids.orgBId);

    const name = `Org2 destination ${stamp}`;
    const res = await call("POST", `/organizations/${ids.orgBId}/close`, ids.ownerId!, {
      // Case and padding are forgiven; identity is not.
      body: { confirmName: `  ${name.toUpperCase()}  ` },
    });
    expect(res.status).toBe(200);

    const stored = await prisma.organization.findUniqueOrThrow({ where: { id: ids.orgBId! } });
    expect(stored.closedAt).toBeInstanceOf(Date);
    expect(stored.closedByUserId).toBe(ids.ownerId);

    // Closing is not deleting: the row and its memberships survive.
    expect(
      await prisma.orgMembership.count({ where: { organizationId: ids.orgBId! } }),
    ).toBeGreaterThan(0);

    // It leaves every console surface that reads /organizations/mine…
    const mine = await call("GET", "/organizations/mine", ids.ownerId!);
    expect((mine.body as unknown as Array<{ id: string }>).map((o) => o.id)).not.toContain(
      ids.orgBId,
    );

    // …and stops blocking account deletion, which is the whole point.
    expect(await findSoleOwnerOrgIds(ids.ownerId!)).not.toContain(ids.orgBId);

    // A closed organization accepts nothing further.
    const again = await call("POST", `/organizations/${ids.orgBId}/close`, ids.ownerId!, {
      body: { confirmName: name },
    });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("ORG_CLOSED");

    const renamed = await fetch(`${base}/organizations/${ids.orgBId}`, {
      method: "PUT",
      headers: { authorization: auth(ids.ownerId!), "content-type": "application/json" },
      body: JSON.stringify({ name: "Reopened by the back door" }),
    });
    expect(renamed.status).toBe(409);

    const created = await call("POST", "/event/", ids.ownerId!, {
      body: {
        name: "Should not exist",
        organizationId: ids.orgBId!,
        timezone: "UTC",
        startDate: new Date("2027-06-01T09:00:00Z").toISOString(),
        endDate: new Date("2027-06-02T17:00:00Z").toISOString(),
      },
    });
    expect(created.status).toBe(409);

    // Reopen for teardown only — no route can do this, which is the point.
    await prisma.organization.update({
      where: { id: ids.orgBId! },
      data: { closedAt: null, closedByUserId: null },
    });
  }, 60_000);

  /* ---------------------------------------------------------------- *
   * 5 + 6 — draft-only event transfer
   * ---------------------------------------------------------------- */

  it("refuses to move a published event, with reasons and the honest alternative", async () => {
    const pre = await call("GET", "/event/transfer-organization", ids.ownerId!, {
      eventId: ids.publishedEventId!,
    });
    expect(pre.status).toBe(200);
    expect(pre.body.canTransfer).toBe(false);
    expect(String((pre.body.reasons as string[]).join(" "))).toMatch(/only a draft can move/i);
    expect(String(pre.body.recommendation)).toMatch(/re-import/i);

    const res = await call("POST", "/event/transfer-organization", ids.ownerId!, {
      eventId: ids.publishedEventId!,
      body: { organizationId: ids.orgAId! },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EVENT_TRANSFER_BLOCKED");
    const kinds = (res.body.blockers as Array<{ kind: string }>).map((b) => b.kind);
    expect(kinds).toContain("NOT_DRAFT");
    expect(kinds).toContain("CERTIFICATES");
    expect(kinds).toContain("AI_USAGE");
    expect(String(res.body.recommendation)).toMatch(/re-import/i);

    expect(
      (await prisma.event.findUniqueOrThrow({ where: { id: ids.publishedEventId! } }))
        .organizationId,
    ).toBe(ids.orgDirtyId);
  }, 60_000);

  it("still refuses organizationId on a settings save (W-6), whatever the event's status", async () => {
    const res = await fetch(`${base}/event/`, {
      method: "PUT",
      headers: {
        authorization: auth(ids.ownerId!),
        "content-type": "application/json",
        "x-event-id": ids.draftEventId!,
      },
      body: JSON.stringify({ name: "Org2 Draft", organizationId: ids.orgBId! }),
    });
    expect(res.status).toBe(400);
    expect(
      (await prisma.event.findUniqueOrThrow({ where: { id: ids.draftEventId! } })).organizationId,
    ).toBe(ids.orgAId);
  }, 60_000);

  it("moves a clean draft and leaves NO row anywhere still pointing at the old organization", async () => {
    // The seed put a purchase on the draft, which disqualifies it. Clear that
    // one row so the draft is genuinely clean, and confirm it was blocking.
    const blocked = await call("GET", "/event/transfer-organization", ids.ownerId!, {
      eventId: ids.draftEventId!,
    });
    expect(blocked.body.canTransfer).toBe(false);
    expect((blocked.body.blockers as Array<{ kind: string }>).map((b) => b.kind)).toContain(
      "PURCHASES",
    );
    await prisma.eventPurchase.deleteMany({ where: { eventId: ids.draftEventId! } });
    await prisma.aiUsageRecord.deleteMany({ where: { eventId: ids.draftEventId! } });

    const pre = await call("GET", "/event/transfer-organization", ids.ownerId!, {
      eventId: ids.draftEventId!,
    });
    expect(pre.body.canTransfer).toBe(true);
    expect((pre.body.targets as Array<{ id: string }>).map((t) => t.id)).toContain(ids.orgBId);

    const res = await call("POST", "/event/transfer-organization", ids.ownerId!, {
      eventId: ids.draftEventId!,
      body: { organizationId: ids.orgBId! },
    });
    expect(res.status).toBe(200);
    expect(res.body.organizationId).toBe(ids.orgBId);

    // The event itself.
    expect(
      (await prisma.event.findUniqueOrThrow({ where: { id: ids.draftEventId! } })).organizationId,
    ).toBe(ids.orgBId);

    // Every child table: nothing left behind, and the rows that exist moved.
    const eventId = ids.draftEventId!;
    const counts: Record<string, { stale: number; moved: number }> = {
      EventPurchase: {
        stale: await prisma.eventPurchase.count({ where: { eventId, organizationId: ids.orgAId! } }),
        moved: await prisma.eventPurchase.count({ where: { eventId, organizationId: ids.orgBId! } }),
      },
      AdminAccessRequest: {
        stale: await prisma.adminAccessRequest.count({
          where: { eventId, organizationId: ids.orgAId! },
        }),
        moved: await prisma.adminAccessRequest.count({
          where: { eventId, organizationId: ids.orgBId! },
        }),
      },
      AiUsageRecord: {
        stale: await prisma.aiUsageRecord.count({ where: { eventId, organizationId: ids.orgAId! } }),
        moved: await prisma.aiUsageRecord.count({ where: { eventId, organizationId: ids.orgBId! } }),
      },
      AuditLog: {
        stale: await prisma.auditLog.count({ where: { eventId, organizationId: ids.orgAId! } }),
        moved: await prisma.auditLog.count({ where: { eventId, organizationId: ids.orgBId! } }),
      },
      BackgroundJob: {
        stale: await prisma.backgroundJob.count({ where: { eventId, organizationId: ids.orgAId! } }),
        moved: await prisma.backgroundJob.count({ where: { eventId, organizationId: ids.orgBId! } }),
      },
      AgendaIngestRun: {
        stale: await prisma.agendaIngestRun.count({
          where: { eventId, organizationId: ids.orgAId! },
        }),
        moved: await prisma.agendaIngestRun.count({
          where: { eventId, organizationId: ids.orgBId! },
        }),
      },
      OpsInboxCard: {
        stale: await prisma.opsInboxCard.count({ where: { eventId, organizationId: ids.orgAId! } }),
        moved: await prisma.opsInboxCard.count({ where: { eventId, organizationId: ids.orgBId! } }),
      },
      BadgeTemplate: {
        stale: await prisma.badgeTemplate.count({ where: { eventId, organizationId: ids.orgAId! } }),
        moved: await prisma.badgeTemplate.count({ where: { eventId, organizationId: ids.orgBId! } }),
      },
      CertificateTemplate: {
        stale: await prisma.certificateTemplate.count({
          where: { eventId, organizationId: ids.orgAId! },
        }),
        moved: await prisma.certificateTemplate.count({
          where: { eventId, organizationId: ids.orgBId! },
        }),
      },
      IssuedCertificate: {
        stale: await prisma.issuedCertificate.count({
          where: { eventId, organizationId: ids.orgAId! },
        }),
        moved: await prisma.issuedCertificate.count({
          where: { eventId, organizationId: ids.orgBId! },
        }),
      },
      EventRecap: {
        stale: await prisma.eventRecap.count({ where: { eventId, organizationId: ids.orgAId! } }),
        moved: await prisma.eventRecap.count({ where: { eventId, organizationId: ids.orgBId! } }),
      },
      ReadinessTemplate: {
        stale: await prisma.readinessTemplate.count({
          where: { eventId, organizationId: ids.orgAId! },
        }),
        moved: await prisma.readinessTemplate.count({
          where: { eventId, organizationId: ids.orgBId! },
        }),
      },
      // The two with no foreign key — the orphans nothing else would catch.
      ReadinessAssignment: {
        stale: await prisma.readinessAssignment.count({
          where: { eventId, organizationId: ids.orgAId! },
        }),
        moved: await prisma.readinessAssignment.count({
          where: { eventId, organizationId: ids.orgBId! },
        }),
      },
      ReadinessPortalAccess: {
        stale: await prisma.readinessPortalAccess.count({
          where: { eventId, organizationId: ids.orgAId! },
        }),
        moved: await prisma.readinessPortalAccess.count({
          where: { eventId, organizationId: ids.orgBId! },
        }),
      },
    };

    // Every table in the constant is checked here, so the two lists cannot drift.
    expect(Object.keys(counts).sort()).toEqual([...EVENT_ORGANIZATION_CHILD_TABLES].sort());

    for (const [table, { stale }] of Object.entries(counts)) {
      expect(stale, `${table} left a row pointing at the old organization`).toBe(0);
    }

    // The tables that were seeded really did carry a row across, so the zeroes
    // above are a move rather than an empty table.
    for (const table of [
      "AdminAccessRequest",
      "AuditLog",
      "BackgroundJob",
      "AgendaIngestRun",
      "OpsInboxCard",
      "BadgeTemplate",
      "CertificateTemplate",
      "EventRecap",
      "ReadinessTemplate",
      "ReadinessAssignment",
      "ReadinessPortalAccess",
    ]) {
      expect(counts[table]!.moved, `${table} should have moved a row`).toBeGreaterThan(0);
    }

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { eventId, entityType: "Event" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit.organizationId).toBe(ids.orgBId);
    expect(audit.payload).toMatchObject({
      action: "event_organization_transferred",
      fromOrganizationId: ids.orgAId,
      toOrganizationId: ids.orgBId,
    });

    // Same organization twice is a no-op, not a silent second move.
    const same = await call("POST", "/event/transfer-organization", ids.ownerId!, {
      eventId,
      body: { organizationId: ids.orgBId! },
    });
    expect(same.status).toBe(400);
  }, 120_000);

  it("refuses a destination the caller does not run", async () => {
    // STAFF in the source org may edit the agenda but may not move the event.
    const res = await call("POST", "/event/transfer-organization", ids.staffId!, {
      eventId: ids.draftEventId!,
      body: { organizationId: ids.orgAId! },
    });
    expect(res.status).toBe(403);
  }, 60_000);
});
