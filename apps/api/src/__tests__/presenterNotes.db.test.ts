/**
 * PRESENTER-HOME-B — note route auth, the daily cap, and JOINING-only fan-out.
 *
 * Does NOT set ALLOW_DESTRUCTIVE_DB.
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
import {
  EventMemberRole,
  NotificationDelivery,
  OrgRole,
  PrismaClient,
  SessionAttendanceStatus,
  SessionJoinMode,
} from "@prisma/client";
import { presenterNoteNotificationTitle } from "@event-app/shared";
import { hashPassword, signToken } from "../lib/auth";
import { upsertFeatureOverrides } from "../lib/features";
import { _resetRateLimitBucketsForTests } from "../lib/rateLimit";
import { portalRouter } from "../routes/portal";
import { readinessRouter } from "../routes/readiness";
import { sessionsRouter } from "../routes/sessions";

describe("presenter notes (DB, PRESENTER-HOME-B)", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  const ids: {
    admin?: string;
    joining?: string;
    waiting?: string;
    skipped?: string;
    org?: string;
    event?: string;
    speaker1?: string;
    speaker2?: string;
    sessionMine?: string;
    sessionTheirs?: string;
  } = {};
  let rawToken = "";
  const stamp = Date.now();

  beforeAll(async () => {
    const passwordHash = await hashPassword("TestPass12!x");
    const admin = await prisma.user.create({
      data: { email: `note-admin-${stamp}@example.com`, name: "Note Admin", passwordHash, role: "ADMIN" },
    });
    const joining = await prisma.user.create({
      data: { email: `note-join-${stamp}@example.com`, name: "Joining Person", passwordHash, role: "ATTENDEE" },
    });
    const waiting = await prisma.user.create({
      data: { email: `note-wait-${stamp}@example.com`, name: "Waiting Person", passwordHash, role: "ATTENDEE" },
    });
    const skipped = await prisma.user.create({
      data: { email: `note-skip-${stamp}@example.com`, name: "Not Joining", passwordHash, role: "ATTENDEE" },
    });
    ids.admin = admin.id;
    ids.joining = joining.id;
    ids.waiting = waiting.id;
    ids.skipped = skipped.id;

    const org = await prisma.organization.create({
      data: {
        name: `Note Org ${stamp}`,
        slug: `note-org-${stamp}`,
        plan: "INTERNAL",
        memberships: { create: { userId: admin.id, role: OrgRole.OWNER } },
      },
    });
    ids.org = org.id;

    const event = await prisma.event.create({
      data: {
        name: `Note Event ${stamp}`,
        slug: `note-evt-${stamp}`,
        timezone: "America/Los_Angeles",
        startDate: new Date("2027-03-01T12:00:00Z"),
        endDate: new Date("2027-03-03T12:00:00Z"),
        organizationId: org.id,
        createdById: admin.id,
        presenterRosterVisibility: "NAMES",
        presenterNotesEnabled: true,
        memberships: {
          create: [
            { userId: admin.id, role: EventMemberRole.ADMIN },
            { userId: joining.id, role: EventMemberRole.ATTENDEE, directoryOptIn: true },
            { userId: waiting.id, role: EventMemberRole.ATTENDEE, directoryOptIn: true },
            { userId: skipped.id, role: EventMemberRole.ATTENDEE, directoryOptIn: true },
          ],
        },
      },
    });
    ids.event = event.id;

    const speaker1 = await prisma.speaker.create({
      data: { eventId: event.id, name: "Maya Chen" },
    });
    const speaker2 = await prisma.speaker.create({
      data: { eventId: event.id, name: "Other Speaker" },
    });
    ids.speaker1 = speaker1.id;
    ids.speaker2 = speaker2.id;

    const mine = await prisma.session.create({
      data: {
        eventId: event.id,
        title: "Opening keynote",
        startsAt: new Date("2027-03-01T17:00:00Z"),
        endsAt: new Date("2027-03-01T18:00:00Z"),
        sessionSpeakers: { create: [{ speakerId: speaker1.id, sortOrder: 0 }] },
      },
    });
    const theirs = await prisma.session.create({
      data: {
        eventId: event.id,
        title: "Someone else's workshop",
        startsAt: new Date("2027-03-01T19:00:00Z"),
        endsAt: new Date("2027-03-01T20:00:00Z"),
        sessionSpeakers: { create: [{ speakerId: speaker2.id, sortOrder: 0 }] },
      },
    });
    ids.sessionMine = mine.id;
    ids.sessionTheirs = theirs.id;

    const template = await prisma.readinessTemplate.create({
      data: { eventId: event.id, organizationId: org.id, name: "Presenter pack" },
    });
    const req = await prisma.readinessRequirement.create({
      data: {
        templateId: template.id,
        eventId: event.id,
        label: "Short bio",
        kind: "short_text",
        required: true,
        sortOrder: 0,
      },
    });
    await prisma.readinessAssignment.create({
      data: {
        organizationId: org.id,
        eventId: event.id,
        requirementId: req.id,
        speakerId: speaker1.id,
      },
    });

    await prisma.sessionAttendance.createMany({
      data: [
        {
          userId: joining.id,
          sessionId: mine.id,
          status: SessionAttendanceStatus.JOINING,
          joinMode: SessionJoinMode.IN_PERSON,
        },
        {
          userId: skipped.id,
          sessionId: mine.id,
          status: SessionAttendanceStatus.NOT_JOINING,
        },
      ],
    });
    await prisma.waitlistEntry.create({
      data: {
        sessionId: mine.id,
        userId: waiting.id,
        mode: SessionJoinMode.IN_PERSON,
        position: 1,
      },
    });

    await upsertFeatureOverrides(event.id, { readiness: true });

    const app = express();
    app.use(express.json());
    app.use("/readiness", readinessRouter);
    app.use("/portal", portalRouter);
    app.use("/sessions", sessionsRouter);
    await new Promise<void>((resolveListen) => {
      server = app.listen(0, "127.0.0.1", resolveListen);
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    _resetRateLimitBucketsForTests();

    const mint = await fetch(`${base}/readiness/portal-access`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${signToken({ userId: admin.id, role: "ADMIN" })}`,
        "content-type": "application/json",
        "x-event-id": event.id,
      },
      body: JSON.stringify({ speakerId: speaker1.id, email: `note-maya-${stamp}@example.com` }),
    });
    const minted = (await mint.json()) as { url?: string };
    rawToken = minted.url?.split("/r/")[1] ?? "";
  }, 60_000);

  afterAll(async () => {
    if (ids.event) {
      await prisma.userNotification.deleteMany({ where: { eventId: ids.event } }).catch(() => undefined);
      await prisma.presenterNote.deleteMany({ where: { session: { eventId: ids.event } } }).catch(() => undefined);
      await prisma.waitlistEntry.deleteMany({ where: { session: { eventId: ids.event } } }).catch(() => undefined);
      await prisma.sessionAttendance.deleteMany({ where: { session: { eventId: ids.event } } }).catch(() => undefined);
      await prisma.sessionSpeaker.deleteMany({ where: { session: { eventId: ids.event } } }).catch(() => undefined);
      await prisma.readinessAssignment.deleteMany({ where: { eventId: ids.event } }).catch(() => undefined);
      await prisma.readinessRequirement.deleteMany({ where: { eventId: ids.event } }).catch(() => undefined);
      await prisma.readinessTemplate.deleteMany({ where: { eventId: ids.event } }).catch(() => undefined);
      await prisma.readinessPortalAccess.deleteMany({ where: { eventId: ids.event } }).catch(() => undefined);
      await prisma.session.deleteMany({ where: { eventId: ids.event } }).catch(() => undefined);
      await prisma.speaker.deleteMany({ where: { eventId: ids.event } }).catch(() => undefined);
      await prisma.eventFeatureConfig.deleteMany({ where: { eventId: ids.event } }).catch(() => undefined);
      await prisma.eventMembership.deleteMany({ where: { eventId: ids.event } }).catch(() => undefined);
      await prisma.event.delete({ where: { id: ids.event } }).catch(() => undefined);
    }
    if (ids.org) {
      await prisma.orgMembership.deleteMany({ where: { organizationId: ids.org } }).catch(() => undefined);
      await prisma.organization.delete({ where: { id: ids.org } }).catch(() => undefined);
    }
    await prisma.user.deleteMany({
      where: {
        email: {
          in: [
            `note-admin-${stamp}@example.com`,
            `note-join-${stamp}@example.com`,
            `note-wait-${stamp}@example.com`,
            `note-skip-${stamp}@example.com`,
            `note-maya-${stamp}@example.com`,
          ],
        },
      },
    }).catch(() => undefined);
    await prisma.$disconnect();
    if (server) {
      await new Promise<void>((resolveClose, reject) =>
        server.close((err) => (err ? reject(err) : resolveClose())),
      );
    }
  }, 60_000);

  function postNote(token: string, sessionId: string, body: string) {
    return fetch(`${base}/portal/${encodeURIComponent(token)}/sessions/${encodeURIComponent(sessionId)}/note`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body }),
    });
  }

  it("rejects a bad token, another speaker's session, and a disabled setting", async () => {
    expect(rawToken).not.toBe("");
    const wrong = await postNote("not-a-real-token", ids.sessionMine!, "Hello");
    expect(wrong.status).toBe(404);

    const other = await postNote(rawToken, ids.sessionTheirs!, "Hello");
    expect(other.status).toBe(404);

    await prisma.event.update({ where: { id: ids.event! }, data: { presenterNotesEnabled: false } });
    const off = await postNote(rawToken, ids.sessionMine!, "Hello");
    expect(off.status).toBe(403);
    await prisma.event.update({ where: { id: ids.event! }, data: { presenterNotesEnabled: true } });

    const notes = await prisma.presenterNote.count({ where: { sessionId: ids.sessionMine! } });
    expect(notes).toBe(0);
  });

  it("notifies JOINING attendees only, shows the note on the session, and stops at 3 per day", async () => {
    const title = presenterNoteNotificationTitle("Maya Chen", "Opening keynote");
    const first = await postNote(rawToken, ids.sessionMine!, "Bring one question.");
    expect(first.status).toBe(201);
    const created = (await first.json()) as { body: string };
    expect(created.body).toBe("Bring one question.");

    const rows = await prisma.userNotification.findMany({ where: { eventId: ids.event! } });
    expect(rows.map((row) => row.userId).sort()).toEqual([ids.joining]);
    expect(rows[0]?.title).toBe(title);
    expect(rows[0]?.body).toBe("Bring one question.");
    expect(rows[0]?.delivery).toBe(NotificationDelivery.INBOX);
    expect(rows.some((row) => row.userId === ids.waiting)).toBe(false);
    expect(rows.some((row) => row.userId === ids.skipped)).toBe(false);

    const second = await postNote(rawToken, ids.sessionMine!, "See you at the door.");
    const third = await postNote(rawToken, ids.sessionMine!, "  We'll start on time.  ");
    expect(second.status).toBe(201);
    expect(third.status).toBe(201);
    const fourth = await postNote(rawToken, ids.sessionMine!, "One more.");
    expect(fourth.status).toBe(429);

    const view = await fetch(`${base}/sessions/${ids.sessionMine!}`, {
      headers: {
        authorization: `Bearer ${signToken({ userId: ids.joining!, role: "ATTENDEE" })}`,
        "x-event-id": ids.event!,
      },
    });
    expect(view.status).toBe(200);
    const session = (await view.json()) as { presenterNotes: Array<{ body: string }> };
    expect(session.presenterNotes.map((note) => note.body)).toEqual([
      "We'll start on time.",
      "See you at the door.",
      "Bring one question.",
    ]);
    expect(JSON.stringify(session.presenterNotes)).not.toMatch(/email|userId|joinMode/);
  });
});
