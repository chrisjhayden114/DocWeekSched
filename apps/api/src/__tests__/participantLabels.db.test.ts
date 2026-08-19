/**
 * PART-1 — organizer-defined per-event participant labels.
 * Does NOT set ALLOW_DESTRUCTIVE_DB.
 *
 * Decision under test: deleting a label from the event list NULLs
 * memberships that held it.
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
import { eventRouter } from "../routes/event";
import { attendeesRouter } from "../routes/attendees";

type EventBody = { participantLabels?: string[]; error?: string };
type LabelBody = { participantLabel?: string | null; error?: string };
type AttendeeRow = { id: string; participantLabel?: string | null; participantType?: string | null };

describe("participant labels (DB)", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  const ids: {
    orgId?: string;
    eventAId?: string;
    eventBId?: string;
    adminId?: string;
    attendeeId?: string;
  } = {};

  beforeAll(async () => {
    const passwordHash = await hashPassword("TestPass12!x");
    const stamp = Date.now();

    const admin = await prisma.user.create({
      data: {
        email: `part1-admin-${stamp}@example.com`,
        name: "Labels Admin",
        role: "ADMIN",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const attendee = await prisma.user.create({
      data: {
        email: `part1-att-${stamp}@example.com`,
        name: "Labels Attendee",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    ids.adminId = admin.id;
    ids.attendeeId = attendee.id;

    const org = await prisma.organization.create({
      data: {
        name: `Labels Org ${stamp}`,
        slug: `part1-org-${stamp}`,
        plan: "PRO",
        eventAllowance: 5,
        memberships: { create: { userId: admin.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;

    const eventA = await prisma.event.create({
      data: {
        name: `Labels Event A ${stamp}`,
        slug: `part1-a-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2027-06-01T09:00:00Z"),
        endDate: new Date("2027-06-02T17:00:00Z"),
        status: EventStatus.ACTIVE,
        organizationId: org.id,
        createdById: admin.id,
        memberships: {
          create: [
            { userId: admin.id, role: EventMemberRole.ADMIN },
            { userId: attendee.id, role: EventMemberRole.ATTENDEE },
          ],
        },
      },
    });
    const eventB = await prisma.event.create({
      data: {
        name: `Labels Event B ${stamp}`,
        slug: `part1-b-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2027-07-01T09:00:00Z"),
        endDate: new Date("2027-07-02T17:00:00Z"),
        status: EventStatus.ACTIVE,
        organizationId: org.id,
        createdById: admin.id,
        memberships: {
          create: [
            { userId: admin.id, role: EventMemberRole.ADMIN },
            { userId: attendee.id, role: EventMemberRole.ATTENDEE },
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
    for (const eventId of [ids.eventAId, ids.eventBId]) {
      if (!eventId) continue;
      await prisma.eventMembership.deleteMany({ where: { eventId } }).catch(() => null);
      await prisma.event.delete({ where: { id: eventId } }).catch(() => null);
    }
    if (ids.orgId) {
      await prisma.orgMembership.deleteMany({ where: { organizationId: ids.orgId } }).catch(() => null);
      await prisma.organization.delete({ where: { id: ids.orgId } }).catch(() => null);
    }
    for (const userId of [ids.adminId, ids.attendeeId]) {
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

  function eventFields() {
    return {
      name: "Labels Event A",
      timezone: "UTC",
      startDate: "2027-06-01T09:00:00.000Z",
      endDate: "2027-06-02T17:00:00.000Z",
    };
  }

  async function putEvent(body: Record<string, unknown>, eventId = ids.eventAId!) {
    const res = await fetch(`${base}/event/`, {
      method: "PUT",
      headers: headers(ids.adminId!, "ADMIN", eventId),
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as EventBody };
  }

  it("organizer defines labels; a name-only save leaves them intact", async () => {
    const defined = await putEvent({
      ...eventFields(),
      participantLabels: ["Class of 2028", "Science Dept"],
    });
    expect(defined.status).toBe(200);
    expect(defined.body.participantLabels).toEqual(["Class of 2028", "Science Dept"]);

    const nameOnly = await putEvent(eventFields());
    expect(nameOnly.status).toBe(200);
    expect(nameOnly.body.participantLabels).toEqual(["Class of 2028", "Science Dept"]);
  }, 60_000);

  it("attendee sets their own label; list responses use participantLabel not participantType", async () => {
    const seeded = await putEvent({
      ...eventFields(),
      participantLabels: ["Class of 2028", "Science Dept"],
    });
    expect(seeded.status).toBe(200);

    const set = await fetch(`${base}/attendees/me`, {
      method: "PUT",
      headers: headers(ids.attendeeId!, "ATTENDEE", ids.eventAId!),
      body: JSON.stringify({ participantLabel: "Class of 2028" }),
    });
    expect(set.status).toBe(200);
    expect(((await set.json()) as LabelBody).participantLabel).toBe("Class of 2028");

    const me = await fetch(`${base}/attendees/me`, {
      headers: headers(ids.attendeeId!, "ATTENDEE", ids.eventAId!),
    });
    expect(me.status).toBe(200);
    expect(((await me.json()) as LabelBody).participantLabel).toBe("Class of 2028");

    const list = await fetch(`${base}/attendees`, {
      headers: headers(ids.adminId!, "ADMIN", ids.eventAId!),
    });
    expect(list.status).toBe(200);
    const rows = (await list.json()) as AttendeeRow[];
    const self = rows.find((r) => r.id === ids.attendeeId);
    expect(self?.participantLabel).toBe("Class of 2028");
    expect(self).not.toHaveProperty("participantType");
  }, 60_000);

  it("organizer overrides a member's label", async () => {
    await putEvent({
      ...eventFields(),
      participantLabels: ["Class of 2028", "Science Dept"],
    });
    await fetch(`${base}/attendees/me`, {
      method: "PUT",
      headers: headers(ids.attendeeId!, "ATTENDEE", ids.eventAId!),
      body: JSON.stringify({ participantLabel: "Class of 2028" }),
    });

    const res = await fetch(`${base}/attendees/${ids.attendeeId}`, {
      method: "PUT",
      headers: headers(ids.adminId!, "ADMIN", ids.eventAId!),
      body: JSON.stringify({ participantLabel: "Science Dept" }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as LabelBody).participantLabel).toBe("Science Dept");

    const stored = await prisma.eventMembership.findUniqueOrThrow({
      where: { eventId_userId: { eventId: ids.eventAId!, userId: ids.attendeeId! } },
    });
    expect(stored.participantLabel).toBe("Science Dept");
  }, 60_000);

  it("deleting a label from the event list NULLs memberships that held it", async () => {
    await putEvent({
      ...eventFields(),
      participantLabels: ["Class of 2028", "Science Dept"],
    });
    await fetch(`${base}/attendees/${ids.attendeeId}`, {
      method: "PUT",
      headers: headers(ids.adminId!, "ADMIN", ids.eventAId!),
      body: JSON.stringify({ participantLabel: "Science Dept" }),
    });
    const held = await prisma.eventMembership.findUniqueOrThrow({
      where: { eventId_userId: { eventId: ids.eventAId!, userId: ids.attendeeId! } },
    });
    expect(held.participantLabel).toBe("Science Dept");

    const res = await putEvent({
      ...eventFields(),
      participantLabels: ["Class of 2028"],
    });
    expect(res.status).toBe(200);
    expect(res.body.participantLabels).toEqual(["Class of 2028"]);

    const stored = await prisma.eventMembership.findUniqueOrThrow({
      where: { eventId_userId: { eventId: ids.eventAId!, userId: ids.attendeeId! } },
    });
    expect(stored.participantLabel).toBeNull();
  }, 60_000);

  it("rejects a label defined on event A when writing at event B", async () => {
    await putEvent({
      ...eventFields(),
      participantLabels: ["Class of 2028"],
    });

    const onB = await fetch(`${base}/attendees/me`, {
      method: "PUT",
      headers: headers(ids.attendeeId!, "ATTENDEE", ids.eventBId!),
      body: JSON.stringify({ participantLabel: "Class of 2028" }),
    });
    expect(onB.status).toBe(400);
    const body = (await onB.json()) as LabelBody;
    expect(body.error).toMatch(/this event's participant labels/i);

    const storedB = await prisma.eventMembership.findUniqueOrThrow({
      where: { eventId_userId: { eventId: ids.eventBId!, userId: ids.attendeeId! } },
    });
    expect(storedB.participantLabel).toBeNull();
  }, 60_000);
});
