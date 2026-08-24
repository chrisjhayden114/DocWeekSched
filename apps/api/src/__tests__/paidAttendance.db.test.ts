/**
 * PAY-T0 — paid attendance, end to end against the real routes.
 * Does NOT set ALLOW_DESTRUCTIVE_DB.
 *
 * The contract under test, in order of how much damage getting it wrong would
 * do:
 *  1) Off means off. With the `paid_attendance` feature off, the three Event
 *     payment columns exist on the row but appear in NO payload — not the
 *     public page, not the member's own /attendees/me, not GET /event — and
 *     the roster carries no payment fields at all.
 *  2) Payment state is organizer-only. An attendee listing the directory never
 *     sees anyone's paymentStatus, including their own.
 *  3) Every write is manage-gated, feature-gated, and audited.
 *  4) Event scoping: a real member id from another event is a 404, not a
 *     cross-tenant write.
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
import { EventMemberRole, EventStatus, OrgRole, PrismaClient } from "@prisma/client";
import { hashPassword, signToken } from "../lib/auth";
import { upsertFeatureOverrides } from "../lib/features";
import { getPublicEventBySlug } from "../lib/publicEvent";
import { attendeesRouter } from "../routes/attendees";
import { eventRouter } from "../routes/event";

type EventBody = {
  paymentPriceText?: string | null;
  paymentUrl?: string | null;
  paymentInstructions?: string | null;
  error?: string;
};
type MeBody = {
  payment?: { priceText: string | null; url: string | null; instructions: string | null } | null;
  error?: string;
};
type RosterRow = {
  id: string;
  name: string;
  paymentStatus?: string | null;
  paymentReference?: string | null;
};
type PaymentBody = { paymentStatus?: string | null; paymentReference?: string | null; error?: string };
type BulkBody = {
  updatedCount?: number;
  unchangedCount?: number;
  notOnRoster?: string[];
  error?: string;
};
type DryRunBody = {
  rows?: { kind: string; rowIndex: number; userId?: string; message?: string }[];
  summary?: { creates: number; errors: number; skipped: number };
  marksAs?: string;
  error?: string;
};

describe("paid attendance (DB, PAY-T0)", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  const stamp = Date.now();
  const slugA = `pay-a-${stamp}`;
  const ids: {
    orgId?: string;
    eventAId?: string;
    eventBId?: string;
    adminId?: string;
    attendeeId?: string;
    otherId?: string;
    onlyOnBId?: string;
  } = {};

  beforeAll(async () => {
    const passwordHash = await hashPassword("TestPass12!x");

    const admin = await prisma.user.create({
      data: {
        email: `pay-admin-${stamp}@example.com`,
        name: "Fee Admin",
        role: "ADMIN",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const attendee = await prisma.user.create({
      data: {
        email: `pay-att-${stamp}@example.com`,
        name: "Fee Attendee",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const other = await prisma.user.create({
      data: {
        email: `pay-other-${stamp}@example.com`,
        name: "Other Attendee",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const onlyOnB = await prisma.user.create({
      data: {
        email: `pay-onlyb-${stamp}@example.com`,
        name: "Event B Only",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    ids.adminId = admin.id;
    ids.attendeeId = attendee.id;
    ids.otherId = other.id;
    ids.onlyOnBId = onlyOnB.id;

    const org = await prisma.organization.create({
      data: {
        name: `Fee Org ${stamp}`,
        slug: `pay-org-${stamp}`,
        plan: "PRO",
        eventAllowance: 5,
        memberships: { create: { userId: admin.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;

    const eventA = await prisma.event.create({
      data: {
        name: `Fee Event A ${stamp}`,
        slug: slugA,
        timezone: "UTC",
        startDate: new Date("2027-06-01T09:00:00Z"),
        endDate: new Date("2027-06-02T17:00:00Z"),
        status: EventStatus.ACTIVE,
        organizationId: org.id,
        createdById: admin.id,
        memberships: {
          create: [
            { userId: admin.id, role: EventMemberRole.ADMIN },
            { userId: attendee.id, role: EventMemberRole.ATTENDEE, directoryOptIn: true },
            { userId: other.id, role: EventMemberRole.ATTENDEE, directoryOptIn: true },
          ],
        },
      },
    });
    const eventB = await prisma.event.create({
      data: {
        name: `Fee Event B ${stamp}`,
        slug: `pay-b-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2027-07-01T09:00:00Z"),
        endDate: new Date("2027-07-02T17:00:00Z"),
        status: EventStatus.ACTIVE,
        organizationId: org.id,
        createdById: admin.id,
        memberships: {
          create: [
            { userId: admin.id, role: EventMemberRole.ADMIN },
            { userId: onlyOnB.id, role: EventMemberRole.ATTENDEE },
          ],
        },
      },
    });
    ids.eventAId = eventA.id;
    ids.eventBId = eventB.id;

    const app = express();
    app.use(express.json());
    app.use("/event", eventRouter);
    app.use("/attendees", attendeesRouter);
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
    const eventIds = [ids.eventAId, ids.eventBId].filter((x): x is string => Boolean(x));
    if (eventIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { eventId: { in: eventIds } } }).catch(() => null);
      await prisma.eventFeatureConfig
        .deleteMany({ where: { eventId: { in: eventIds } } })
        .catch(() => null);
      await prisma.eventMembership
        .deleteMany({ where: { eventId: { in: eventIds } } })
        .catch(() => null);
      await prisma.event.deleteMany({ where: { id: { in: eventIds } } }).catch(() => null);
    }
    if (ids.orgId) {
      await prisma.orgMembership.deleteMany({ where: { organizationId: ids.orgId } }).catch(() => null);
      await prisma.organization.delete({ where: { id: ids.orgId } }).catch(() => null);
    }
    for (const userId of [ids.adminId, ids.attendeeId, ids.otherId, ids.onlyOnBId]) {
      if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => null);
    }
    await prisma.$disconnect();
    if (server) {
      await new Promise<void>((resolveClose, reject) =>
        server.close((err) => (err ? reject(err) : resolveClose())),
      );
    }
  }, 60_000);

  function headers(userId: string, role: "ADMIN" | "ATTENDEE", eventId: string) {
    return {
      authorization: `Bearer ${signToken({ userId, role })}`,
      "content-type": "application/json",
      "x-event-id": eventId,
    };
  }

  function eventFields(name = "Fee Event A") {
    return {
      name,
      timezone: "UTC",
      startDate: "2027-06-01T09:00:00.000Z",
      endDate: "2027-06-02T17:00:00.000Z",
    };
  }

  const feeFields = {
    paymentPriceText: "$120 · $95 members",
    paymentUrl: "https://buy.stripe.com/test-fee",
    paymentInstructions: "POs: email finance@district.org. Checks payable to Fee Org.",
  };

  async function putEvent(body: Record<string, unknown>, eventId = ids.eventAId!) {
    const res = await fetch(`${base}/event/`, {
      method: "PUT",
      headers: headers(ids.adminId!, "ADMIN", eventId),
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as EventBody };
  }

  async function getRoster(
    userId = ids.adminId!,
    role: "ADMIN" | "ATTENDEE" = "ADMIN",
    eventId = ids.eventAId!,
  ) {
    const res = await fetch(`${base}/attendees`, { headers: headers(userId, role, eventId) });
    return { status: res.status, rows: (await res.json()) as RosterRow[] };
  }

  async function getMe(userId = ids.attendeeId!, eventId = ids.eventAId!) {
    const res = await fetch(`${base}/attendees/me`, {
      headers: headers(userId, "ATTENDEE", eventId),
    });
    return { status: res.status, body: (await res.json()) as MeBody };
  }

  async function setFeature(on: boolean, eventId = ids.eventAId!) {
    await upsertFeatureOverrides(eventId, { paid_attendance: on });
  }

  async function auditRows(action: string, eventId = ids.eventAId!) {
    const rows = await prisma.auditLog.findMany({
      where: { eventId },
      orderBy: { createdAt: "asc" },
    });
    return rows.filter((row) => (row.payload as { action?: string } | null)?.action === action);
  }

  /* ----------------------------------------------------------------- *
   * 1) Feature off
   * ----------------------------------------------------------------- */

  it("feature off: the fee fields cannot even be written", async () => {
    await setFeature(false);
    const res = await putEvent({ ...eventFields(), ...feeFields });
    expect(res.status).toBe(404);

    const stored = await prisma.event.findUniqueOrThrow({ where: { id: ids.eventAId! } });
    expect(stored.paymentPriceText).toBeNull();
    expect(stored.paymentUrl).toBeNull();
    expect(stored.paymentInstructions).toBeNull();
  }, 60_000);

  it("feature off: no payment field appears in the public payload, /event, or the roster", async () => {
    // Write the columns directly, bypassing the gate, so the payload is the
    // only thing being tested — stored data must stay invisible.
    await prisma.event.update({ where: { id: ids.eventAId! }, data: feeFields });
    await setFeature(false);

    const publicPayload = await getPublicEventBySlug(slugA);
    expect(publicPayload).not.toBeNull();
    expect(publicPayload!.payment).toBeNull();
    expect(JSON.stringify(publicPayload)).not.toContain("buy.stripe.com");
    expect(JSON.stringify(publicPayload)).not.toContain("$120");

    const ev = await fetch(`${base}/event/`, {
      headers: headers(ids.adminId!, "ADMIN", ids.eventAId!),
    });
    const evBody = (await ev.json()) as EventBody;
    expect(evBody).not.toHaveProperty("paymentPriceText");
    expect(evBody).not.toHaveProperty("paymentUrl");
    expect(evBody).not.toHaveProperty("paymentInstructions");

    const roster = await getRoster();
    expect(roster.status).toBe(200);
    for (const row of roster.rows) {
      expect(row).not.toHaveProperty("paymentStatus");
      expect(row).not.toHaveProperty("paymentReference");
    }

    const me = await getMe();
    expect(me.status).toBe(200);
    expect(me.body.payment).toBeNull();
  }, 60_000);

  it("feature off: every payment write route 404s", async () => {
    await setFeature(false);
    const one = await fetch(`${base}/attendees/${ids.attendeeId}/payment`, {
      method: "PUT",
      headers: headers(ids.adminId!, "ADMIN", ids.eventAId!),
      body: JSON.stringify({ paymentStatus: "PAID" }),
    });
    expect(one.status).toBe(404);

    const bulk = await fetch(`${base}/attendees/payment-bulk`, {
      method: "POST",
      headers: headers(ids.adminId!, "ADMIN", ids.eventAId!),
      body: JSON.stringify({ paymentStatus: "PAID", members: [{ userId: ids.attendeeId }] }),
    });
    expect(bulk.status).toBe(404);

    const dry = await fetch(`${base}/attendees/paid-dry-run`, {
      method: "POST",
      headers: headers(ids.adminId!, "ADMIN", ids.eventAId!),
      body: JSON.stringify({ headers: ["Email"], rows: [] }),
    });
    expect(dry.status).toBe(404);

    const stored = await prisma.eventMembership.findUniqueOrThrow({
      where: { eventId_userId: { eventId: ids.eventAId!, userId: ids.attendeeId! } },
    });
    expect(stored.paymentStatus).toBeNull();
  }, 60_000);

  /* ----------------------------------------------------------------- *
   * 2) Feature on
   * ----------------------------------------------------------------- */

  it("feature on: the organizer saves a fee and attendees see the notice", async () => {
    await prisma.event.update({
      where: { id: ids.eventAId! },
      data: { paymentPriceText: null, paymentUrl: null, paymentInstructions: null },
    });
    await setFeature(true);

    const saved = await putEvent({ ...eventFields(), ...feeFields });
    expect(saved.status).toBe(200);
    expect(saved.body.paymentPriceText).toBe(feeFields.paymentPriceText);
    expect(saved.body.paymentUrl).toBe(feeFields.paymentUrl);

    const publicPayload = await getPublicEventBySlug(slugA);
    expect(publicPayload!.payment).toEqual({
      priceText: feeFields.paymentPriceText,
      url: feeFields.paymentUrl,
      instructions: feeFields.paymentInstructions,
    });

    const me = await getMe();
    expect(me.body.payment).toEqual({
      priceText: feeFields.paymentPriceText,
      url: feeFields.paymentUrl,
      instructions: feeFields.paymentInstructions,
    });
    // The attendee's own status is deliberately absent: nothing is gated on it.
    expect(me.body).not.toHaveProperty("paymentStatus");
  }, 60_000);

  it("feature on: saving the fee is audited", async () => {
    await setFeature(true);
    const before = (await auditRows("registration_fee_settings_saved")).length;
    const res = await putEvent({ ...eventFields(), paymentPriceText: "$130" });
    expect(res.status).toBe(200);

    const rows = await auditRows("registration_fee_settings_saved");
    expect(rows.length).toBe(before + 1);
    const latest = rows[rows.length - 1]!;
    expect(latest.actorUserId).toBe(ids.adminId);
    expect(latest.organizationId).toBe(ids.orgId);
    expect(latest.payload).toMatchObject({ fields: ["paymentPriceText"], hasPriceText: true });
  }, 60_000);

  it("a save that omits the fee fields leaves them intact and writes no fee audit row", async () => {
    await setFeature(true);
    await putEvent({ ...eventFields(), ...feeFields });
    const before = (await auditRows("registration_fee_settings_saved")).length;

    const nameOnly = await putEvent(eventFields("Fee Event A renamed"));
    expect(nameOnly.status).toBe(200);
    expect(nameOnly.body.paymentPriceText).toBe(feeFields.paymentPriceText);
    expect((await auditRows("registration_fee_settings_saved")).length).toBe(before);
  }, 60_000);

  it("an emptied fee clears the notice rather than leaving a stale price", async () => {
    await setFeature(true);
    await putEvent({ ...eventFields(), ...feeFields });
    const cleared = await putEvent({
      ...eventFields(),
      paymentPriceText: null,
      paymentUrl: null,
      paymentInstructions: null,
    });
    expect(cleared.status).toBe(200);
    // Feature still on, but nothing to say — so there is no notice at all.
    expect((await getPublicEventBySlug(slugA))!.payment).toBeNull();
    expect((await getMe()).body.payment).toBeNull();
  }, 60_000);

  it("rejects a payment link that isn't http(s), and stores nothing", async () => {
    await setFeature(true);
    await putEvent({ ...eventFields(), ...feeFields });
    const res = await putEvent({ ...eventFields(), paymentUrl: "javascript:alert(1)" });
    expect(res.status).toBe(400);

    const stored = await prisma.event.findUniqueOrThrow({ where: { id: ids.eventAId! } });
    expect(stored.paymentUrl).toBe(feeFields.paymentUrl);
  }, 60_000);

  /* ----------------------------------------------------------------- *
   * 3) Status writes
   * ----------------------------------------------------------------- */

  it("sets one member's status and reference, and audits the change", async () => {
    await setFeature(true);
    const res = await fetch(`${base}/attendees/${ids.attendeeId}/payment`, {
      method: "PUT",
      headers: headers(ids.adminId!, "ADMIN", ids.eventAId!),
      body: JSON.stringify({ paymentStatus: "PO_ON_FILE", paymentReference: " PO-4471 " }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PaymentBody;
    expect(body).toEqual({ paymentStatus: "PO_ON_FILE", paymentReference: "PO-4471" });

    const stored = await prisma.eventMembership.findUniqueOrThrow({
      where: { eventId_userId: { eventId: ids.eventAId!, userId: ids.attendeeId! } },
    });
    expect(stored.paymentStatus).toBe("PO_ON_FILE");
    expect(stored.paymentReference).toBe("PO-4471");

    const rows = await auditRows("payment_status_set");
    const latest = rows[rows.length - 1]!;
    expect(latest.actorUserId).toBe(ids.adminId);
    expect(latest.payload).toMatchObject({
      targetUserId: ids.attendeeId,
      toStatus: "PO_ON_FILE",
      referenceChanged: true,
    });
  }, 60_000);

  it("clearing the status back to null is allowed and is not the same as UNPAID", async () => {
    await setFeature(true);
    const res = await fetch(`${base}/attendees/${ids.attendeeId}/payment`, {
      method: "PUT",
      headers: headers(ids.adminId!, "ADMIN", ids.eventAId!),
      body: JSON.stringify({ paymentStatus: null }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as PaymentBody).paymentStatus).toBeNull();

    const roster = await getRoster();
    const row = roster.rows.find((r) => r.id === ids.attendeeId);
    expect(row?.paymentStatus).toBeNull();
  }, 60_000);

  it("rejects an invented status and writes nothing", async () => {
    await setFeature(true);
    await fetch(`${base}/attendees/${ids.attendeeId}/payment`, {
      method: "PUT",
      headers: headers(ids.adminId!, "ADMIN", ids.eventAId!),
      body: JSON.stringify({ paymentStatus: "WAIVED" }),
    });
    const res = await fetch(`${base}/attendees/${ids.attendeeId}/payment`, {
      method: "PUT",
      headers: headers(ids.adminId!, "ADMIN", ids.eventAId!),
      body: JSON.stringify({ paymentStatus: "COMPED" }),
    });
    expect(res.status).toBe(400);

    const stored = await prisma.eventMembership.findUniqueOrThrow({
      where: { eventId_userId: { eventId: ids.eventAId!, userId: ids.attendeeId! } },
    });
    expect(stored.paymentStatus).toBe("WAIVED");
  }, 60_000);

  it("bulk 'Mark paid' updates only what changed and audits the run", async () => {
    await setFeature(true);
    await fetch(`${base}/attendees/${ids.attendeeId}/payment`, {
      method: "PUT",
      headers: headers(ids.adminId!, "ADMIN", ids.eventAId!),
      body: JSON.stringify({ paymentStatus: "PAID" }),
    });
    await fetch(`${base}/attendees/${ids.otherId}/payment`, {
      method: "PUT",
      headers: headers(ids.adminId!, "ADMIN", ids.eventAId!),
      body: JSON.stringify({ paymentStatus: "UNPAID" }),
    });

    const res = await fetch(`${base}/attendees/payment-bulk`, {
      method: "POST",
      headers: headers(ids.adminId!, "ADMIN", ids.eventAId!),
      body: JSON.stringify({
        paymentStatus: "PAID",
        source: "roster_bulk",
        members: [{ userId: ids.attendeeId }, { userId: ids.otherId }],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as BulkBody;
    expect(body.updatedCount).toBe(1);
    expect(body.unchangedCount).toBe(1);
    expect(body.notOnRoster).toEqual([]);

    const rows = await auditRows("payment_status_bulk");
    const latest = rows[rows.length - 1]!;
    expect(latest.payload).toMatchObject({ source: "roster_bulk", toStatus: "PAID" });
  }, 60_000);

  it("bulk reports ids that aren't on this roster instead of creating them", async () => {
    await setFeature(true);
    const res = await fetch(`${base}/attendees/payment-bulk`, {
      method: "POST",
      headers: headers(ids.adminId!, "ADMIN", ids.eventAId!),
      body: JSON.stringify({
        paymentStatus: "PAID",
        members: [{ userId: ids.onlyOnBId }],
      }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as BulkBody).notOnRoster).toEqual([ids.onlyOnBId]);

    // The membership that DOES exist, at event B, is untouched.
    const onB = await prisma.eventMembership.findUniqueOrThrow({
      where: { eventId_userId: { eventId: ids.eventBId!, userId: ids.onlyOnBId! } },
    });
    expect(onB.paymentStatus).toBeNull();
  }, 60_000);

  /* ----------------------------------------------------------------- *
   * 4) CSV paid list
   * ----------------------------------------------------------------- */

  it("CSV dry-run matches the roster, lists unmatched emails, and writes nothing", async () => {
    await setFeature(true);
    await fetch(`${base}/attendees/${ids.attendeeId}/payment`, {
      method: "PUT",
      headers: headers(ids.adminId!, "ADMIN", ids.eventAId!),
      body: JSON.stringify({ paymentStatus: null }),
    });

    const res = await fetch(`${base}/attendees/paid-dry-run`, {
      method: "POST",
      headers: headers(ids.adminId!, "ADMIN", ids.eventAId!),
      body: JSON.stringify({
        headers: ["Email", "PO"],
        rows: [
          { Email: `PAY-ATT-${stamp}@example.com`.toLowerCase(), PO: "PO-7" },
          { Email: "nobody@elsewhere.org", PO: "" },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DryRunBody;
    expect(body.marksAs).toBe("PAID");
    expect(body.summary).toEqual({ creates: 1, errors: 1, skipped: 0 });
    expect(body.rows!.find((r) => r.kind === "create")!.userId).toBe(ids.attendeeId);
    expect(body.rows!.find((r) => r.kind === "error")!.message).toContain("nobody@elsewhere.org");

    const stored = await prisma.eventMembership.findUniqueOrThrow({
      where: { eventId_userId: { eventId: ids.eventAId!, userId: ids.attendeeId! } },
    });
    expect(stored.paymentStatus).toBeNull();
  }, 60_000);

  it("confirming the CSV run sets PAID with the reference, and audits it as a CSV run", async () => {
    await setFeature(true);
    const res = await fetch(`${base}/attendees/payment-bulk`, {
      method: "POST",
      headers: headers(ids.adminId!, "ADMIN", ids.eventAId!),
      body: JSON.stringify({
        paymentStatus: "PAID",
        source: "csv_paid_list",
        members: [{ userId: ids.attendeeId, paymentReference: "PO-7" }],
      }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as BulkBody).updatedCount).toBe(1);

    const stored = await prisma.eventMembership.findUniqueOrThrow({
      where: { eventId_userId: { eventId: ids.eventAId!, userId: ids.attendeeId! } },
    });
    expect(stored.paymentStatus).toBe("PAID");
    expect(stored.paymentReference).toBe("PO-7");

    const rows = await auditRows("payment_status_bulk");
    expect(rows[rows.length - 1]!.payload).toMatchObject({ source: "csv_paid_list" });
  }, 60_000);

  /* ----------------------------------------------------------------- *
   * 5) Who may see and write
   * ----------------------------------------------------------------- */

  it("an attendee never sees anyone's payment status — not even their own", async () => {
    await setFeature(true);
    const roster = await getRoster(ids.attendeeId!, "ATTENDEE");
    expect(roster.status).toBe(200);
    expect(roster.rows.length).toBeGreaterThan(0);
    for (const row of roster.rows) {
      expect(row).not.toHaveProperty("paymentStatus");
      expect(row).not.toHaveProperty("paymentReference");
    }
    expect(JSON.stringify(roster.rows)).not.toContain("PO-7");
  }, 60_000);

  it("an attendee cannot write payment state, on themselves or anyone else", async () => {
    await setFeature(true);
    for (const target of [ids.attendeeId, ids.otherId]) {
      const res = await fetch(`${base}/attendees/${target}/payment`, {
        method: "PUT",
        headers: headers(ids.attendeeId!, "ATTENDEE", ids.eventAId!),
        body: JSON.stringify({ paymentStatus: "PAID" }),
      });
      expect(res.status).toBe(403);
    }
    const bulk = await fetch(`${base}/attendees/payment-bulk`, {
      method: "POST",
      headers: headers(ids.attendeeId!, "ATTENDEE", ids.eventAId!),
      body: JSON.stringify({ paymentStatus: "PAID", members: [{ userId: ids.attendeeId }] }),
    });
    expect(bulk.status).toBe(403);

    const stored = await prisma.eventMembership.findUniqueOrThrow({
      where: { eventId_userId: { eventId: ids.eventAId!, userId: ids.otherId! } },
    });
    expect(stored.paymentStatus).toBe("PAID");
  }, 60_000);

  /* ----------------------------------------------------------------- *
   * 6) Cross-event isolation
   * ----------------------------------------------------------------- */

  it("event B is a separate ledger: its own feature state, fee, and statuses", async () => {
    await setFeature(true, ids.eventAId!);
    await setFeature(false, ids.eventBId!);

    // Feature on at A does not turn it on at B.
    const meOnB = await fetch(`${base}/attendees/me`, {
      headers: headers(ids.onlyOnBId!, "ATTENDEE", ids.eventBId!),
    });
    expect(((await meOnB.json()) as MeBody).payment).toBeNull();

    // A member of event A is a 404 at event B, even with the feature on there.
    await setFeature(true, ids.eventBId!);
    const crossWrite = await fetch(`${base}/attendees/${ids.otherId}/payment`, {
      method: "PUT",
      headers: headers(ids.adminId!, "ADMIN", ids.eventBId!),
      body: JSON.stringify({ paymentStatus: "REFUNDED" }),
    });
    expect(crossWrite.status).toBe(404);

    const stillAtA = await prisma.eventMembership.findUniqueOrThrow({
      where: { eventId_userId: { eventId: ids.eventAId!, userId: ids.otherId! } },
    });
    expect(stillAtA.paymentStatus).toBe("PAID");

    // Event B's fee is its own — saving at B leaves A alone.
    const savedB = await putEvent(
      {
        name: "Fee Event B",
        timezone: "UTC",
        startDate: "2027-07-01T09:00:00.000Z",
        endDate: "2027-07-02T17:00:00.000Z",
        paymentPriceText: "Free for staff",
      },
      ids.eventBId!,
    );
    expect(savedB.status).toBe(200);
    expect(savedB.body.paymentPriceText).toBe("Free for staff");

    const eventA = await prisma.event.findUniqueOrThrow({ where: { id: ids.eventAId! } });
    expect(eventA.paymentPriceText).toBe(feeFields.paymentPriceText);

    // And B's roster carries none of A's payment references.
    const rosterB = await getRoster(ids.adminId!, "ADMIN", ids.eventBId!);
    expect(JSON.stringify(rosterB.rows)).not.toContain("PO-7");
    expect(rosterB.rows.every((r) => !r.paymentStatus)).toBe(true);
  }, 60_000);
});
