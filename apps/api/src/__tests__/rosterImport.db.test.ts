/**
 * W-2 ROSTER-IMPORT (DB) — the founder's ask, asserted end to end:
 * a spreadsheet can land on the roster with labels and WITHOUT emailing
 * anyone, invites are a separate deliberate action, a seat limit reports an
 * honest partial, and the pre-W-2 invite-bulk path is untouched.
 *
 * Does NOT set ALLOW_DESTRUCTIVE_DB.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "fs";
import { resolve } from "path";
import dotenv from "dotenv";

for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
  if (existsSync(p)) dotenv.config({ path: p });
}

// Belt and braces: this suite asserts on the mailer, so force the no-op
// provider before anything can construct a real one. No email can leave.
process.env.EMAIL_PROVIDER = "none";
delete process.env.RESEND_API_KEY;

import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { EventMemberRole, EventStatus, OrgRole, PrismaClient } from "@prisma/client";
import { hashPassword, signToken } from "../lib/auth";
import { getEmailProvider, resetEmailProviderForTests } from "../lib/email";
import { _resetRateLimitBucketsForTests } from "../lib/rateLimit";
import { attendeesRouter } from "../routes/attendees";
import { eventRouter } from "../routes/event";

type ImportBody = {
  ok?: boolean;
  createdCount?: number;
  skippedCount?: number;
  created?: { userId: string; email: string; name: string; participantLabel: string | null }[];
  skipped?: { email: string; reason: string }[];
  emailsSent?: boolean;
  error?: string;
  invalidLabels?: { email: string; label: string }[];
  upgrade?: { code: string; limitKey?: string; max?: number | null };
};

type SendInvitesBody = {
  ok?: boolean;
  sentCount?: number;
  failedCount?: number;
  alreadyActiveCount?: number;
  results?: {
    userId: string;
    email: string | null;
    status: "sent" | "failed" | "already-active";
    emailDelivered?: boolean;
    inviteUrl?: string;
    error?: string;
  }[];
  error?: string;
};

type RosterRow = {
  id: string;
  email: string;
  inviteStatus?: string;
  participantLabel?: string | null;
  eventRole?: string;
};

type BulkBody = {
  ok?: boolean;
  sentCount?: number;
  failedCount?: number;
  sent?: { email: string; inviteUrl: string; emailDelivered: boolean }[];
  failed?: { email: string; error: string }[];
};

describe("W-2 roster import (DB)", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  const stamp = Date.now();
  const ids: { orgId?: string; eventId?: string; capEventId?: string; adminId?: string } = {};
  const importedEmails = [
    `w2-ada-${stamp}@example.com`,
    `w2-grace-${stamp}@example.com`,
    `w2-alan-${stamp}@example.com`,
  ];
  const capEmails = [`w2-cap1-${stamp}@example.com`, `w2-cap2-${stamp}@example.com`];
  const bulkEmail = `w2-bulk-${stamp}@example.com`;
  const createdUserEmails = [...importedEmails, ...capEmails, bulkEmail];

  beforeAll(async () => {
    resetEmailProviderForTests();
    const passwordHash = await hashPassword("TestPass12!x");

    const admin = await prisma.user.create({
      data: {
        email: `w2-admin-${stamp}@example.com`,
        name: "Roster Admin",
        role: "ADMIN",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    ids.adminId = admin.id;

    const org = await prisma.organization.create({
      data: {
        name: `Roster Org ${stamp}`,
        slug: `w2-org-${stamp}`,
        plan: "PRO",
        eventAllowance: 5,
        memberships: { create: { userId: admin.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;

    const eventData = (suffix: string, attendeeCap: number) => ({
      name: `Roster Event ${suffix} ${stamp}`,
      slug: `w2-${suffix}-${stamp}`,
      timezone: "UTC",
      startDate: new Date("2027-06-01T09:00:00Z"),
      endDate: new Date("2027-06-02T17:00:00Z"),
      status: EventStatus.ACTIVE,
      organizationId: org.id,
      createdById: admin.id,
      attendeeCap,
      participantLabelsJson: JSON.stringify(["Class of 2028", "Science Dept"]),
      memberships: { create: [{ userId: admin.id, role: EventMemberRole.ADMIN }] },
    });
    const event = await prisma.event.create({ data: eventData("main", 50) });
    // Admin already holds a seat, so this event has room for exactly one import.
    const capEvent = await prisma.event.create({ data: eventData("cap", 2) });
    ids.eventId = event.id;
    ids.capEventId = capEvent.id;

    const app = express();
    app.use(express.json({ limit: "2mb" }));
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

  beforeEach(() => {
    // The invite routes are rate-limited per user; a whole feature driven from
    // one test file would otherwise start getting 429s part-way through.
    _resetRateLimitBucketsForTests();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    for (const eventId of [ids.eventId, ids.capEventId]) {
      if (!eventId) continue;
      await prisma.eventMembership.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.event.delete({ where: { id: eventId } }).catch(() => null);
    }
    if (ids.orgId) {
      await prisma.orgMembership.deleteMany({ where: { organizationId: ids.orgId } }).catch(() => null);
      await prisma.organization.delete({ where: { id: ids.orgId } }).catch(() => null);
    }
    await prisma.user
      .deleteMany({ where: { email: { in: createdUserEmails } } })
      .catch(() => null);
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

  async function post<T>(path: string, body: unknown, eventId = ids.eventId!) {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: headers(eventId),
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as T };
  }

  async function roster(eventId = ids.eventId!): Promise<RosterRow[]> {
    const res = await fetch(`${base}/attendees`, { headers: headers(eventId) });
    expect(res.status).toBe(200);
    return (await res.json()) as RosterRow[];
  }

  it("import creates seats with labels and sends nothing at all", async () => {
    const sendSpy = vi.spyOn(getEmailProvider(), "send");

    const res = await post<ImportBody>("/attendees/import", {
      participants: [
        { email: importedEmails[0], name: "Ada Lovelace", participantLabel: "Class of 2028" },
        { email: importedEmails[1], name: "Grace Hopper", participantLabel: "Science Dept" },
        { email: importedEmails[2], name: "Alan Turing" },
      ],
    });

    expect(res.status).toBe(200);
    expect(res.body.createdCount).toBe(3);
    expect(res.body.emailsSent).toBe(false);
    // The founder's actual requirement: no email side-effects, at all.
    expect(sendSpy).not.toHaveBeenCalled();

    const labels = await prisma.eventMembership.findMany({
      where: { eventId: ids.eventId!, user: { email: { in: importedEmails } } },
      select: { participantLabel: true, addedWithoutInviteAt: true, user: { select: { email: true } } },
    });
    expect(labels).toHaveLength(3);
    expect(
      labels.find((m) => m.user.email === importedEmails[0])?.participantLabel,
    ).toBe("Class of 2028");
    expect(
      labels.find((m) => m.user.email === importedEmails[1])?.participantLabel,
    ).toBe("Science Dept");
    expect(labels.find((m) => m.user.email === importedEmails[2])?.participantLabel).toBeNull();
    // Every imported seat carries the marker the NOT_INVITED state derives from.
    expect(labels.every((m) => m.addedWithoutInviteAt != null)).toBe(true);

    // No setup token was minted for anyone — nothing to leak, nothing to expire.
    const users = await prisma.user.findMany({
      where: { email: { in: importedEmails } },
      select: { email: true, profileSetupTokenHash: true },
    });
    expect(users).toHaveLength(3);
    expect(users.every((u) => u.profileSetupTokenHash == null)).toBe(true);

    const rows = await roster();
    for (const email of importedEmails) {
      expect(rows.find((r) => r.email === email)?.inviteStatus).toBe("NOT_INVITED");
    }
  }, 60_000);

  it("re-importing the same list changes nothing and says so", async () => {
    const sendSpy = vi.spyOn(getEmailProvider(), "send");
    const res = await post<ImportBody>("/attendees/import", {
      participants: [{ email: importedEmails[0], name: "Ada Lovelace" }],
    });
    expect(res.status).toBe(200);
    expect(res.body.createdCount).toBe(0);
    expect(res.body.skipped).toEqual([
      { email: importedEmails[0], reason: "Already on the roster" },
    ]);
    expect(sendSpy).not.toHaveBeenCalled();
  }, 60_000);

  it("a label this event doesn't define stops the import instead of writing half of it", async () => {
    const res = await post<ImportBody>("/attendees/import", {
      participants: [
        { email: `w2-reject-${stamp}@example.com`, name: "Rejected", participantLabel: "Robotics Club" },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.invalidLabels).toEqual([
      { email: `w2-reject-${stamp}@example.com`, label: "Robotics Club" },
    ]);
    const user = await prisma.user.findUnique({ where: { email: `w2-reject-${stamp}@example.com` } });
    expect(user).toBeNull();
  }, 60_000);

  it("send-invites emails only the people picked, and reports the rest", async () => {
    const rows = await roster();
    const ada = rows.find((r) => r.email === importedEmails[0])!;
    const grace = rows.find((r) => r.email === importedEmails[1])!;
    const alan = rows.find((r) => r.email === importedEmails[2])!;
    const admin = rows.find((r) => r.id === ids.adminId)!;

    const sendSpy = vi.spyOn(getEmailProvider(), "send");
    const res = await post<SendInvitesBody>("/attendees/send-invites", {
      userIds: [ada.id, grace.id, admin.id],
    });

    expect(res.status).toBe(200);
    expect(res.body.sentCount).toBe(2);
    // The admin finished setup long ago: reported, never emailed.
    expect(res.body.alreadyActiveCount).toBe(1);
    expect(res.body.failedCount).toBe(0);
    expect(sendSpy).toHaveBeenCalledTimes(2);
    const recipients = sendSpy.mock.calls.map((call) => call[0].to).sort();
    expect(recipients).toEqual([importedEmails[0], importedEmails[1]].sort());
    expect(
      res.body.results?.find((r) => r.userId === admin.id)?.status,
    ).toBe("already-active");
    // Email isn't configured in tests, so each sent item carries its link.
    expect(
      res.body.results?.filter((r) => r.status === "sent").every((r) => Boolean(r.inviteUrl)),
    ).toBe(true);

    const after = await roster();
    expect(after.find((r) => r.email === importedEmails[0])?.inviteStatus).toBe("PENDING_SETUP");
    expect(after.find((r) => r.email === importedEmails[1])?.inviteStatus).toBe("PENDING_SETUP");
    // The person nobody picked is untouched.
    expect(after.find((r) => r.id === alan.id)?.inviteStatus).toBe("NOT_INVITED");
    expect(after.find((r) => r.id === admin.id)?.inviteStatus).toBe("ACTIVE");

    // Labels assigned at import time survive the invite.
    expect(after.find((r) => r.email === importedEmails[0])?.participantLabel).toBe("Class of 2028");
  }, 60_000);

  it("send-invites refuses a user who isn't on this event's roster", async () => {
    const res = await post<SendInvitesBody>("/attendees/send-invites", {
      userIds: ["not-a-member-id"],
    });
    expect(res.status).toBe(200);
    expect(res.body.sentCount).toBe(0);
    expect(res.body.failedCount).toBe(1);
    expect(res.body.results?.[0]?.error).toMatch(/roster/i);
  }, 60_000);

  it("a seat limit mid-import returns honest partial detail", async () => {
    const sendSpy = vi.spyOn(getEmailProvider(), "send");
    const res = await post<ImportBody>(
      "/attendees/import",
      { participants: capEmails.map((email, i) => ({ email, name: `Cap ${i + 1}` })) },
      ids.capEventId!,
    );

    expect(res.status).toBe(402);
    expect(res.body.upgrade?.limitKey).toBe("attendees");
    // Exactly one seat fitted: the response names who got in and who didn't.
    expect(res.body.createdCount).toBe(1);
    expect(res.body.created?.[0]?.email).toBe(capEmails[0]);
    expect(res.body.emailsSent).toBe(false);
    expect(sendSpy).not.toHaveBeenCalled();

    const seats = await prisma.eventMembership.count({
      where: { eventId: ids.capEventId!, deletedAt: null },
    });
    expect(seats).toBe(2);
  }, 60_000);

  it("the pre-W-2 invite-bulk path still creates the seat AND emails, unchanged", async () => {
    const sendSpy = vi.spyOn(getEmailProvider(), "send");
    const res = await post<BulkBody>("/attendees/invite-bulk", {
      invites: [{ email: bulkEmail, name: "Bulk Invitee" }],
    });

    expect(res.status).toBe(200);
    expect(res.body.sentCount).toBe(1);
    expect(res.body.failedCount).toBe(0);
    expect(res.body.sent?.[0]?.email).toBe(bulkEmail);
    expect(res.body.sent?.[0]?.inviteUrl).toContain("/invite/");
    expect(res.body.sent?.[0]?.emailDelivered).toBe(false);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    const rows = await roster();
    // Invited, not imported: the roster reads "Invite sent", never NOT_INVITED.
    expect(rows.find((r) => r.email === bulkEmail)?.inviteStatus).toBe("PENDING_SETUP");
    const membership = await prisma.eventMembership.findFirst({
      where: { eventId: ids.eventId!, user: { email: bulkEmail } },
      select: { addedWithoutInviteAt: true },
    });
    expect(membership?.addedWithoutInviteAt).toBeNull();

    // Re-inviting someone who already finished setup is still refused.
    const again = await post<BulkBody>("/attendees/invite-bulk", {
      invites: [{ email: `w2-admin-${stamp}@example.com`, name: "Roster Admin" }],
    });
    expect(again.status).toBe(200);
    expect(again.body.sentCount).toBe(0);
    expect(again.body.failed?.[0]?.error).toMatch(/already on the event roster/i);
  }, 60_000);
});
