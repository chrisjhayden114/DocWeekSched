/**
 * PRESENTER-ROSTER-1 — portal sessions + session-page roster (DB harness).
 *
 * Portal route returns only the token's own sessions; NAMES excludes
 * directory-hidden attendees and counts them; COUNTS carries no attendees
 * array; OFF → 404; expired token → existing behaviour; no email or user id
 * anywhere in the payload. Session-page route 403s anyone who is not the
 * presenter.
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
  OrgRole,
  PrismaClient,
  SessionAttendanceStatus,
  SessionJoinMode,
} from "@prisma/client";
import { hashPassword, hashToken, signToken } from "../lib/auth";
import { upsertFeatureOverrides } from "../lib/features";
import { _resetRateLimitBucketsForTests } from "../lib/rateLimit";
import { portalRouter } from "../routes/portal";
import { readinessRouter } from "../routes/readiness";
import { sessionsRouter } from "../routes/sessions";

describe("presenter roster (DB, PRESENTER-ROSTER-1)", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  const ids: {
    admin?: string;
    attendeeVisible?: string;
    attendeeHidden?: string;
    attendeeOther?: string;
    stranger?: string;
    org?: string;
    event?: string;
    speaker1?: string;
    speaker2?: string;
    sessionMine?: string;
    sessionTheirs?: string;
    sessionAssigned?: string;
  } = {};
  let rawToken = "";
  let speaker1Email = "";

  beforeAll(async () => {
    const stamp = Date.now();
    const passwordHash = await hashPassword("TestPass12!x");
    speaker1Email = `roster-ada-${stamp}@example.com`;

    const admin = await prisma.user.create({
      data: { email: `roster-admin-${stamp}@example.com`, name: "Roster Admin", passwordHash, role: "ADMIN" },
    });
    const visible = await prisma.user.create({
      data: {
        email: `roster-vis-${stamp}@example.com`,
        name: "Visible Joiner",
        affiliation: "Riverside",
        passwordHash,
        role: "ATTENDEE",
      },
    });
    const hidden = await prisma.user.create({
      data: {
        email: `roster-hid-${stamp}@example.com`,
        name: "Hidden Joiner",
        affiliation: "Secret Lab",
        passwordHash,
        role: "ATTENDEE",
      },
    });
    const other = await prisma.user.create({
      data: {
        email: `roster-oth-${stamp}@example.com`,
        name: "Other Speaker Account",
        passwordHash,
        role: "ATTENDEE",
      },
    });
    const stranger = await prisma.user.create({
      data: {
        email: `roster-str-${stamp}@example.com`,
        name: "Stranger",
        passwordHash,
        role: "ATTENDEE",
      },
    });
    const adaUser = await prisma.user.create({
      data: {
        email: speaker1Email,
        name: "Ada the Presenter",
        passwordHash,
        role: "ATTENDEE",
      },
    });
    ids.admin = admin.id;
    ids.attendeeVisible = visible.id;
    ids.attendeeHidden = hidden.id;
    ids.attendeeOther = other.id;
    ids.stranger = stranger.id;

    const org = await prisma.organization.create({
      data: {
        name: `Roster Org ${stamp}`,
        slug: `roster-org-${stamp}`,
        plan: "INTERNAL",
        memberships: { create: { userId: admin.id, role: OrgRole.OWNER } },
      },
    });
    ids.org = org.id;

    const event = await prisma.event.create({
      data: {
        name: `Roster Event ${stamp}`,
        slug: `roster-evt-${stamp}`,
        timezone: "America/Los_Angeles",
        startDate: new Date("2027-03-01T12:00:00Z"),
        endDate: new Date("2027-03-03T12:00:00Z"),
        organizationId: org.id,
        createdById: admin.id,
        presenterRosterVisibility: "NAMES",
        memberships: {
          create: [
            { userId: admin.id, role: EventMemberRole.ADMIN },
            { userId: visible.id, role: EventMemberRole.ATTENDEE, directoryOptIn: true },
            { userId: hidden.id, role: EventMemberRole.ATTENDEE, directoryOptIn: false },
            { userId: other.id, role: EventMemberRole.ATTENDEE, directoryOptIn: true },
            { userId: adaUser.id, role: EventMemberRole.ATTENDEE, directoryOptIn: true },
            { userId: stranger.id, role: EventMemberRole.ATTENDEE, directoryOptIn: true },
          ],
        },
      },
    });
    ids.event = event.id;

    const speaker1 = await prisma.speaker.create({
      data: { eventId: event.id, name: "Dr. Ada Keynote" },
    });
    const speaker2 = await prisma.speaker.create({
      data: { eventId: event.id, name: "Prof. Grace Panelist" },
    });
    ids.speaker1 = speaker1.id;
    ids.speaker2 = speaker2.id;

    const mine = await prisma.session.create({
      data: {
        eventId: event.id,
        title: "Ada's keynote",
        startsAt: new Date("2027-03-01T17:00:00Z"),
        endsAt: new Date("2027-03-01T18:00:00Z"),
        inPersonCapacity: 60,
        sessionSpeakers: { create: [{ speakerId: speaker1.id, sortOrder: 0 }] },
      },
    });
    const theirs = await prisma.session.create({
      data: {
        eventId: event.id,
        title: "Grace's workshop",
        startsAt: new Date("2027-03-01T19:00:00Z"),
        endsAt: new Date("2027-03-01T20:00:00Z"),
        sessionSpeakers: { create: [{ speakerId: speaker2.id, sortOrder: 0 }] },
      },
    });
    const assigned = await prisma.session.create({
      data: {
        eventId: event.id,
        title: "Assigned-only session",
        startsAt: new Date("2027-03-02T17:00:00Z"),
        endsAt: new Date("2027-03-02T18:00:00Z"),
      },
    });
    ids.sessionMine = mine.id;
    ids.sessionTheirs = theirs.id;
    ids.sessionAssigned = assigned.id;

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
    await prisma.readinessAssignment.create({
      data: {
        organizationId: org.id,
        eventId: event.id,
        requirementId: req.id,
        speakerId: speaker1.id,
        sessionId: assigned.id,
      },
    });

    await prisma.sessionAttendance.createMany({
      data: [
        {
          userId: visible.id,
          sessionId: mine.id,
          status: SessionAttendanceStatus.JOINING,
          joinMode: SessionJoinMode.IN_PERSON,
        },
        {
          userId: hidden.id,
          sessionId: mine.id,
          status: SessionAttendanceStatus.JOINING,
          joinMode: SessionJoinMode.VIRTUAL,
        },
        {
          userId: visible.id,
          sessionId: theirs.id,
          status: SessionAttendanceStatus.JOINING,
          joinMode: SessionJoinMode.IN_PERSON,
        },
      ],
    });
    await prisma.waitlistEntry.create({
      data: {
        sessionId: mine.id,
        userId: other.id,
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
    _resetRateLimitBucketsForTests();

    const mint = await fetch(`${base}/readiness/portal-access`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${signToken({ userId: admin.id, role: "ADMIN" })}`,
        "content-type": "application/json",
        "x-event-id": event.id,
      },
      body: JSON.stringify({ speakerId: speaker1.id, email: speaker1Email }),
    });
    const minted = (await mint.json()) as { url: string };
    rawToken = minted.url.split("/r/")[1]!;
  }, 60_000);

  afterAll(async () => {
    if (ids.event) {
      await prisma.waitlistEntry.deleteMany({ where: { session: { eventId: ids.event } } });
      await prisma.sessionAttendance.deleteMany({ where: { session: { eventId: ids.event } } });
      await prisma.sessionSpeaker.deleteMany({ where: { session: { eventId: ids.event } } });
      await prisma.readinessAssignment.deleteMany({ where: { eventId: ids.event } });
      await prisma.readinessRequirement.deleteMany({ where: { eventId: ids.event } });
      await prisma.readinessTemplate.deleteMany({ where: { eventId: ids.event } });
      await prisma.readinessPortalAccess.deleteMany({ where: { eventId: ids.event } });
      await prisma.session.deleteMany({ where: { eventId: ids.event } });
      await prisma.speaker.deleteMany({ where: { eventId: ids.event } });
      await prisma.eventFeatureConfig.deleteMany({ where: { eventId: ids.event } });
      await prisma.eventMembership.deleteMany({ where: { eventId: ids.event } });
      await prisma.event.delete({ where: { id: ids.event } }).catch(() => undefined);
    }
    if (ids.org) {
      await prisma.orgMembership.deleteMany({ where: { organizationId: ids.org } });
      await prisma.organization.delete({ where: { id: ids.org } }).catch(() => undefined);
    }
    for (const emailUser of await prisma.user.findMany({
      where: { email: { contains: "roster-" } },
      select: { id: true },
    })) {
      await prisma.user.delete({ where: { id: emailUser.id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    if (server) {
      await new Promise<void>((resolveClose, reject) =>
        server.close((err) => (err ? reject(err) : resolveClose())),
      );
    }
  }, 60_000);

  function authHeaders(userId: string) {
    return {
      authorization: `Bearer ${signToken({ userId, role: "ATTENDEE" })}`,
      "x-event-id": ids.event!,
    };
  }

  function assertNoSecrets(payload: unknown) {
    const raw = JSON.stringify(payload);
    expect(raw).not.toMatch(/@example\.com/i);
    expect(raw).not.toContain(ids.attendeeVisible);
    expect(raw).not.toContain(ids.attendeeHidden);
    expect(raw).not.toContain(ids.attendeeOther);
    expect(raw).not.toContain(speaker1Email);
    expect(raw).not.toMatch(/joinMode/i);
    expect(raw).not.toMatch(/"email"/);
    expect(raw).not.toMatch(/"userId"/);
  }

  it("NAMES returns only this speaker's sessions, hides directory-hidden names, and never leaks ids or emails", async () => {
    const res = await fetch(`${base}/portal/${rawToken}/sessions`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sessions: Array<{
        id: string;
        title: string;
        joinedCount: number;
        waitlistCount: number;
        inPersonCapacity: number | null;
        attendees?: Array<{ displayName: string; affiliation?: string }>;
        hiddenCount?: number;
      }>;
    };
    const titles = body.sessions.map((s) => s.title).sort();
    expect(titles).toEqual(["Ada's keynote", "Assigned-only session"]);
    expect(body.sessions.some((s) => s.id === ids.sessionTheirs)).toBe(false);

    const keynote = body.sessions.find((s) => s.id === ids.sessionMine)!;
    expect(keynote.joinedCount).toBe(2);
    expect(keynote.waitlistCount).toBe(1);
    expect(keynote.inPersonCapacity).toBe(60);
    expect(keynote.attendees).toEqual([{ displayName: "Visible Joiner", affiliation: "Riverside" }]);
    expect(keynote.hiddenCount).toBe(1);
    assertNoSecrets(body);
  }, 60_000);

  it("COUNTS carries no attendees array", async () => {
    await prisma.event.update({
      where: { id: ids.event! },
      data: { presenterRosterVisibility: "COUNTS" },
    });
    const res = await fetch(`${base}/portal/${rawToken}/sessions`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessions: Array<Record<string, unknown>> };
    expect(body.sessions.length).toBe(2);
    for (const session of body.sessions) {
      expect(session).not.toHaveProperty("attendees");
      expect(session).not.toHaveProperty("hiddenCount");
      expect(session.joinedCount).toBeDefined();
    }
    assertNoSecrets(body);
    await prisma.event.update({
      where: { id: ids.event! },
      data: { presenterRosterVisibility: "NAMES" },
    });
  }, 60_000);

  it("OFF → 404, indistinguishable from no sessions", async () => {
    await prisma.event.update({
      where: { id: ids.event! },
      data: { presenterRosterVisibility: "OFF" },
    });
    const res = await fetch(`${base}/portal/${rawToken}/sessions`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { reason?: string };
    expect(body.reason).toBe("unknown");
    await prisma.event.update({
      where: { id: ids.event! },
      data: { presenterRosterVisibility: "NAMES" },
    });
  }, 60_000);

  it("expired token → existing portal 404", async () => {
    const access = await prisma.readinessPortalAccess.findFirstOrThrow({
      where: { eventId: ids.event!, speakerId: ids.speaker1! },
    });
    await prisma.readinessPortalAccess.update({
      where: { id: access.id },
      data: { expiresAt: new Date("2020-01-01T00:00:00Z") },
    });
    const res = await fetch(`${base}/portal/${rawToken}/sessions`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ reason: "expired" });
    await prisma.readinessPortalAccess.update({
      where: { id: access.id },
      data: { expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
    });
  }, 60_000);

  it("session-page roster 403s anyone else and 200s the linked presenter", async () => {
    const forbidden = await fetch(`${base}/sessions/${ids.sessionMine}/presenter-roster`, {
      headers: authHeaders(ids.attendeeVisible!),
    });
    expect(forbidden.status).toBe(403);

    const stranger = await fetch(`${base}/sessions/${ids.sessionMine}/presenter-roster`, {
      headers: authHeaders(ids.stranger!),
    });
    expect(stranger.status).toBe(403);

    const ada = await prisma.user.findUniqueOrThrow({ where: { email: speaker1Email } });
    const allowed = await fetch(`${base}/sessions/${ids.sessionMine}/presenter-roster`, {
      headers: authHeaders(ada.id),
    });
    expect(allowed.status).toBe(200);
    const row = (await allowed.json()) as {
      id: string;
      attendees?: Array<{ displayName: string }>;
      hiddenCount?: number;
    };
    expect(row.id).toBe(ids.sessionMine);
    expect(row.attendees?.map((a) => a.displayName)).toEqual(["Visible Joiner"]);
    expect(row.hiddenCount).toBe(1);
    assertNoSecrets(row);

    // Legacy Session.speakerId link also authorizes.
    await prisma.session.update({
      where: { id: ids.sessionTheirs! },
      data: { speakerId: ids.attendeeOther },
    });
    const legacy = await fetch(`${base}/sessions/${ids.sessionTheirs}/presenter-roster`, {
      headers: authHeaders(ids.attendeeOther!),
    });
    expect(legacy.status).toBe(200);
    expect(((await legacy.json()) as { id: string }).id).toBe(ids.sessionTheirs);
  }, 60_000);

  it("hashed portal token is what is stored, never the raw token", async () => {
    const stored = await prisma.readinessPortalAccess.findFirstOrThrow({
      where: { eventId: ids.event!, speakerId: ids.speaker1! },
    });
    expect(stored.tokenHash).toBe(hashToken(rawToken));
    expect(stored.tokenHash).not.toBe(rawToken);
  });
});
