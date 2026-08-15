/**
 * H-GEN — POST /ai/ingest/generate (DB).
 *
 * The structured "describe your event" form posts parameters; the route
 * serializes them, creates a GENERATED run, and the SAME agenda-ingest job
 * drafts a skeleton (mock provider → generated-pd-day fixture). Confirm then
 * creates DRAFT sessions plus the Breaks/Programme tracks and the named
 * rooms. Attendees get 403; a second generate on a FREE org gets the 402
 * PLAN_LIMIT upgrade payload.
 *
 * NOTE: requires migration 20260816120000_generated_source_kind (additive
 * enum value) and a regenerated Prisma client.
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
  EventStatus,
  OrgRole,
  PrismaClient,
  SessionPublishStatus,
} from "@prisma/client";
import { hashPassword, signToken } from "../lib/auth";
import { MockAiProvider, resetAiProviderForTests } from "../lib/ai";
import { applyPlanSkuToOrg } from "../lib/billing/entitlements";
import { agendaIngestRouter } from "../routes/agendaIngest";
import { drainJobsUntil } from "./setup/jobDrain";
import "../lib/ai/ingest/job";

type RunBody = {
  run: {
    id: string;
    sourceKind: string;
    sourceFileName: string | null;
    status: string;
    changeset?: unknown;
  };
  jobId: string;
};

const GENERATE_PARAMS = {
  dayStart: "09:00",
  dayEnd: "15:00",
  lunch: { start: "12:00", end: "13:00" },
  breaks: [],
  rooms: ["Alder Hall", "Birch Room", "Cedar Room"],
  parallelPerSlot: 3,
  sessionMinutes: 75,
  gapMinutes: 15,
  includeWelcome: true,
  breakoutStyle: true,
  // Fingerprints the generated-pd-day fixture for the mock provider.
  notes: "Professional development day. Fingerprint: GENERATED-PD-DAY-FIXTURE-7Q4.",
};

describe("H-GEN generated agenda (DB)", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  const ids: {
    orgId?: string;
    eventId?: string;
    managerId?: string;
    attendeeId?: string;
    runId?: string;
  } = {};

  beforeAll(async () => {
    process.env.AI_PROVIDER = "mock";
    resetAiProviderForTests(new MockAiProvider());

    const passwordHash = await hashPassword("TestPass12!x");
    const stamp = Date.now();

    const manager = await prisma.user.create({
      data: {
        email: `hgen-mgr-${stamp}@example.com`,
        name: "HGen Manager",
        passwordHash,
        role: "ATTENDEE",
      },
    });
    ids.managerId = manager.id;

    const attendee = await prisma.user.create({
      data: {
        email: `hgen-att-${stamp}@example.com`,
        name: "HGen Attendee",
        passwordHash,
        role: "ATTENDEE",
      },
    });
    ids.attendeeId = attendee.id;

    const org = await prisma.organization.create({
      data: {
        name: `HGen Org ${stamp}`,
        slug: `hgen-org-${stamp}`,
        plan: "FREE",
        eventAllowance: 2,
        memberships: { create: { userId: manager.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;
    await applyPlanSkuToOrg(org.id, "free");

    const event = await prisma.event.create({
      data: {
        name: `HGen PD Day ${stamp}`,
        slug: `hgen-event-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2027-05-20T00:00:00Z"),
        endDate: new Date("2027-05-20T23:59:59Z"),
        status: EventStatus.ACTIVE,
        organizationId: org.id,
        createdById: manager.id,
        memberships: {
          create: [
            { userId: manager.id, role: EventMemberRole.ADMIN },
            { userId: attendee.id, role: EventMemberRole.ATTENDEE },
          ],
        },
      },
    });
    ids.eventId = event.id;

    const app = express();
    app.use(express.json({ limit: "25mb" }));
    app.use("/ai/ingest", agendaIngestRouter);
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
    if (ids.eventId) {
      await prisma.agendaIngestRun.deleteMany({ where: { eventId: ids.eventId } });
      await prisma.sessionItemAuthor.deleteMany({
        where: { sessionItem: { session: { eventId: ids.eventId } } },
      });
      await prisma.sessionItem.deleteMany({ where: { session: { eventId: ids.eventId } } });
      await prisma.sessionSpeaker.deleteMany({ where: { session: { eventId: ids.eventId } } });
      await prisma.session.deleteMany({ where: { eventId: ids.eventId } });
      await prisma.speaker.deleteMany({ where: { eventId: ids.eventId } });
      await prisma.track.deleteMany({ where: { eventId: ids.eventId } });
      await prisma.room.deleteMany({ where: { eventId: ids.eventId } });
      await prisma.eventMembership.deleteMany({ where: { eventId: ids.eventId } });
      await prisma.auditLog.deleteMany({ where: { eventId: ids.eventId } });
      await prisma.aiUsageRecord.deleteMany({ where: { eventId: ids.eventId } });
      await prisma.backgroundJob.deleteMany({ where: { eventId: ids.eventId } });
      await prisma.event.delete({ where: { id: ids.eventId } }).catch(() => undefined);
    }
    if (ids.orgId) {
      await prisma.orgMembership.deleteMany({ where: { organizationId: ids.orgId } });
      await prisma.organization.delete({ where: { id: ids.orgId } }).catch(() => undefined);
    }
    for (const userId of [ids.managerId, ids.attendeeId]) {
      if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    if (server) {
      await new Promise<void>((resolveClose, reject) =>
        server.close((err) => (err ? reject(err) : resolveClose())),
      );
    }
  }, 60_000);

  function headers(userId: string) {
    return {
      authorization: `Bearer ${signToken({ userId, role: "ATTENDEE" })}`,
      "x-event-id": ids.eventId!,
      "content-type": "application/json",
    };
  }

  it("attendee role gets 403 from POST /generate", async () => {
    const res = await fetch(`${base}/ai/ingest/generate`, {
      method: "POST",
      headers: headers(ids.attendeeId!),
      body: JSON.stringify(GENERATE_PARAMS),
    });
    expect(res.status).toBe(403);
  }, 60_000);

  it("POST /generate creates a GENERATED run that reaches READY_FOR_REVIEW", async () => {
    const res = await fetch(`${base}/ai/ingest/generate`, {
      method: "POST",
      headers: headers(ids.managerId!),
      body: JSON.stringify({ ...GENERATE_PARAMS, processInline: true }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as RunBody;
    expect(body.run.sourceKind).toBe("GENERATED");
    expect(body.run.sourceFileName).toBeNull();
    ids.runId = body.run.id;

    await drainJobsUntil(
      async () => {
        const r = await prisma.agendaIngestRun.findUniqueOrThrow({
          where: { id: body.run.id },
          select: { status: true },
        });
        return r.status !== "PENDING" && r.status !== "EXTRACTING";
      },
      { label: "H-GEN generate run" },
    );

    const ready = await prisma.agendaIngestRun.findUniqueOrThrow({ where: { id: body.run.id } });
    expect(ready.status).toBe("READY_FOR_REVIEW");
    expect(ready.sourceTextPreview).toContain("EVENT PARAMETERS");
    const rows = ready.changeset as Array<{ kind: string; session?: { title?: string } }>;
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(11);
    expect(rows.every((r) => r.kind === "create")).toBe(true);
    expect(rows.some((r) => r.session?.title === "Welcome")).toBe(true);
    expect(rows.some((r) => r.session?.title === "Lunch")).toBe(true);
  }, 120_000);

  it("confirm creates DRAFT sessions plus the two tracks and the named rooms", async () => {
    const res = await fetch(`${base}/ai/ingest/${ids.runId!}/confirm`, {
      method: "POST",
      headers: headers(ids.managerId!),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { createdCount: number };
    expect(body.createdCount).toBe(11);

    const drafts = await prisma.session.findMany({
      where: { eventId: ids.eventId!, publishStatus: SessionPublishStatus.DRAFT },
      include: { track: true, room: true },
    });
    expect(drafts).toHaveLength(11);

    const trackNames = new Set(drafts.map((s) => s.track?.name).filter(Boolean));
    expect(trackNames).toEqual(new Set(["Programme", "Breaks"]));

    const rooms = await prisma.room.findMany({ where: { eventId: ids.eventId! } });
    expect(new Set(rooms.map((r) => r.name))).toEqual(
      new Set(["Alder Hall", "Birch Room", "Cedar Room"]),
    );

    // Placeholders only — the generator never invents speakers.
    const speakerLinks = await prisma.sessionSpeaker.count({
      where: { session: { eventId: ids.eventId! } },
    });
    expect(speakerLinks).toBe(0);
  }, 60_000);

  it("second generate on the FREE plan hits the 402 cap with an upgrade payload", async () => {
    const res = await fetch(`${base}/ai/ingest/generate`, {
      method: "POST",
      headers: headers(ids.managerId!),
      body: JSON.stringify(GENERATE_PARAMS),
    });
    expect(res.status).toBe(402);
    const body = (await res.json()) as { upgrade?: { code?: string } };
    expect(body.upgrade?.code).toBe("PLAN_LIMIT");
  }, 60_000);
});
