/**
 * FIX-NULL — PUT /sessions/:id is partial-save safe.
 *
 * The defect this pins, mirroring eventBranding.db.test.ts: the route built its
 * update with `field: parsed.data.field || null` for every nullable column, so
 * ANY save that didn't resend them — the organizer's inline reschedule, a
 * rename, a future partial caller — silently erased the presenter's deck link,
 * Zoom link, recording, image, and room, and unlinked their directory speaker.
 * This is the hot path of the programme, so the contract gets a DB test:
 * absent = untouched, explicit null or "" = clear.
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
import { sessionsRouter } from "../routes/sessions";

/** The presenter's materials — the values a partial save must not touch. */
const SEEDED = {
  location: "Hall A",
  imageUrl: "https://cdn.example.com/session.png",
  zoomLink: "https://zoom.example.com/j/12345",
  recordingUrl: "https://cdn.example.com/recording.mp4",
  fileUrl: "https://cdn.example.com/deck.pdf",
  fileLink: "https://canva.example.com/deck",
  description: "Original abstract",
  speakers: "Dr. Vance",
} as const;

type SessionBody = Record<string, unknown> & { title?: string };
type ErrorBody = { error?: string; details?: Record<string, string[]> };

describe("PUT /sessions/:id partial-save safety (DB)", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  const ids: {
    orgId?: string;
    eventId?: string;
    adminId?: string;
    speakerUserId?: string;
    sessionId?: string;
  } = {};

  beforeAll(async () => {
    const passwordHash = await hashPassword("TestPass12!x");
    const stamp = Date.now();

    const admin = await prisma.user.create({
      data: {
        email: `fixnull-admin-${stamp}@example.com`,
        name: "FixNull Admin",
        role: "ADMIN",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    ids.adminId = admin.id;

    // speakerId is the legacy link to a User account, not to the Speaker roster.
    const speakerUser = await prisma.user.create({
      data: {
        email: `fixnull-speaker-${stamp}@example.com`,
        name: "FixNull Speaker",
        role: "SPEAKER",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    ids.speakerUserId = speakerUser.id;

    const org = await prisma.organization.create({
      data: {
        name: `FixNull Org ${stamp}`,
        slug: `fixnull-org-${stamp}`,
        plan: "PRO",
        eventAllowance: 5,
        memberships: { create: { userId: admin.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;

    const event = await prisma.event.create({
      data: {
        name: `FixNull Event ${stamp}`,
        slug: `fixnull-evt-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2027-05-04T09:00:00Z"),
        endDate: new Date("2027-05-05T17:00:00Z"),
        status: EventStatus.DRAFT,
        organizationId: org.id,
        createdById: admin.id,
        memberships: {
          create: [
            { userId: admin.id, role: EventMemberRole.ADMIN },
            { userId: speakerUser.id, role: EventMemberRole.SPEAKER },
          ],
        },
      },
    });
    ids.eventId = event.id;

    const session = await prisma.session.create({
      data: {
        eventId: event.id,
        title: "Coastal Ecology Panel",
        startsAt: new Date("2027-05-04T10:00:00Z"),
        endsAt: new Date("2027-05-04T11:00:00Z"),
        speakerId: speakerUser.id,
        ...SEEDED,
      },
    });
    ids.sessionId = session.id;

    const app = express();
    app.use(express.json());
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
  }, 60_000);

  afterAll(async () => {
    if (ids.sessionId) {
      await prisma.session.delete({ where: { id: ids.sessionId } }).catch(() => null);
    }
    if (ids.eventId) {
      await prisma.eventMembership.deleteMany({ where: { eventId: ids.eventId } }).catch(() => null);
      await prisma.event.delete({ where: { id: ids.eventId } }).catch(() => null);
    }
    if (ids.orgId) {
      await prisma.orgMembership.deleteMany({ where: { organizationId: ids.orgId } }).catch(() => null);
      await prisma.organization.delete({ where: { id: ids.orgId } }).catch(() => null);
    }
    for (const userId of [ids.adminId, ids.speakerUserId]) {
      if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => null);
    }
    await prisma.$disconnect();
    if (server) {
      await new Promise<void>((resolveClose, reject) =>
        server.close((err) => (err ? reject(err) : resolveClose())),
      );
    }
  }, 60_000);

  /** The required fields every PUT must carry — the schema demands all three. */
  function baseFields(title: string) {
    return {
      title,
      startsAt: "2027-05-04T10:00:00.000Z",
      endsAt: "2027-05-04T11:00:00.000Z",
    };
  }

  async function put(body: SessionBody) {
    const res = await fetch(`${base}/sessions/${ids.sessionId}`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${signToken({ userId: ids.adminId!, role: "ADMIN" })}`,
        "content-type": "application/json",
        "x-event-id": ids.eventId!,
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as SessionBody & ErrorBody };
  }

  async function stored() {
    return prisma.session.findUniqueOrThrow({
      where: { id: ids.sessionId! },
      select: {
        title: true,
        location: true,
        imageUrl: true,
        zoomLink: true,
        recordingUrl: true,
        fileUrl: true,
        fileLink: true,
        speakerId: true,
        description: true,
        speakers: true,
      },
    });
  }

  /** Restore the fully populated starting point so each case stands alone. */
  async function seedSession() {
    await prisma.session.update({
      where: { id: ids.sessionId! },
      data: {
        title: "Coastal Ecology Panel",
        speakerId: ids.speakerUserId!,
        ...SEEDED,
      },
    });
  }

  it("a title-only save leaves every file, link, location, and speaker field intact", async () => {
    await seedSession();

    const res = await put(baseFields("Renamed By Quick Edit"));
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Renamed By Quick Edit");

    // The response and the row must agree — a caller that trusts the response
    // would otherwise re-save the nulls it was handed.
    for (const [field, value] of Object.entries(SEEDED)) {
      expect(res.body[field], field).toBe(value);
    }
    expect(res.body.speakerId).toBe(ids.speakerUserId);

    expect(await stored()).toEqual({
      title: "Renamed By Quick Edit",
      speakerId: ids.speakerUserId,
      ...SEEDED,
    });
  }, 60_000);

  it("a reschedule that touches only the times leaves the materials alone", async () => {
    await seedSession();

    const res = await put({
      title: "Coastal Ecology Panel",
      startsAt: "2027-05-04T14:00:00.000Z",
      endsAt: "2027-05-04T15:00:00.000Z",
      trackId: null,
      roomId: null,
    });
    expect(res.status).toBe(200);
    expect(await stored()).toMatchObject({ speakerId: ids.speakerUserId, ...SEEDED });
  }, 60_000);

  it("an explicit null clears exactly the field it names", async () => {
    await seedSession();

    const one = await put({ ...baseFields("Coastal Ecology Panel"), fileUrl: null });
    expect(one.status).toBe(200);
    expect(await stored()).toMatchObject({
      fileUrl: null,
      fileLink: SEEDED.fileLink,
      zoomLink: SEEDED.zoomLink,
      location: SEEDED.location,
    });

    const rest = await put({
      ...baseFields("Coastal Ecology Panel"),
      zoomLink: null,
      recordingUrl: null,
      imageUrl: null,
      fileLink: null,
      location: null,
      speakerId: null,
    });
    expect(rest.status).toBe(200);
    expect(await stored()).toMatchObject({
      location: null,
      imageUrl: null,
      zoomLink: null,
      recordingUrl: null,
      fileUrl: null,
      fileLink: null,
      speakerId: null,
      // description and speakers are deliberately not patch-shaped, and this
      // payload never mentioned them, so they are untouched either way.
      description: SEEDED.description,
      speakers: SEEDED.speakers,
    });
  }, 60_000);

  it("an emptied or blanked field also clears — a wiped text box means no value", async () => {
    await seedSession();

    const res = await put({
      ...baseFields("Coastal Ecology Panel"),
      location: "   ",
      zoomLink: "",
    });
    expect(res.status).toBe(200);
    expect(await stored()).toMatchObject({
      location: null,
      zoomLink: null,
      fileUrl: SEEDED.fileUrl,
    });
  }, 60_000);

  it("stores a submitted value trimmed", async () => {
    await seedSession();

    const res = await put({ ...baseFields("Coastal Ecology Panel"), location: "  Hall B  " });
    expect(res.status).toBe(200);
    expect(res.body.location).toBe("Hall B");
    expect((await stored()).location).toBe("Hall B");
  }, 60_000);
});
