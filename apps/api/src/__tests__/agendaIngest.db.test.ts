import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EventMemberRole,
  EventStatus,
  OrgRole,
  PrismaClient,
  SessionPublishStatus,
} from "@prisma/client";
import { hashPassword } from "../lib/auth";
import { MockAiProvider, resetAiProviderForTests } from "../lib/ai";
import {
  confirmAgendaChangeset,
  loadFixtureSource,
  runAgendaExtract,
  isSessionAttendeeVisible,
} from "../lib/ai/ingest";
import { applyPlanSkuToOrg } from "../lib/billing/entitlements";
import { HttpError } from "../lib/authorization";
import { assertAiCap } from "../lib/ai";
import { enqueueJob, processDueJobs } from "../lib/jobs";
import { AGENDA_INGEST_JOB_TYPE } from "../lib/ai/ingest/constants";
import "../lib/ai/ingest/job";

describe("Agenda ingest (DB)", () => {
  const prisma = new PrismaClient();
  const ids: {
    orgId?: string;
    eventId?: string;
    managerId?: string;
    attendeeId?: string;
    publishedSessionId?: string;
  } = {};
  let dbReady = false;

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await prisma.agendaIngestRun.findFirst();
    } catch {
      console.warn("[agendaIngest.db.test] DB unreachable or A1 tables missing — skipping");
      return;
    }
    dbReady = true;
    process.env.AI_PROVIDER = "mock";
    resetAiProviderForTests(new MockAiProvider());

    const passwordHash = await hashPassword("TestPass12!x");
    const stamp = Date.now();

    const manager = await prisma.user.create({
      data: {
        email: `ingest-mgr-${stamp}@example.com`,
        name: "Ingest Manager",
        passwordHash,
        role: "ATTENDEE",
      },
    });
    ids.managerId = manager.id;

    const attendee = await prisma.user.create({
      data: {
        email: `ingest-att-${stamp}@example.com`,
        name: "Ingest Attendee",
        passwordHash,
        role: "ATTENDEE",
      },
    });
    ids.attendeeId = attendee.id;

    const org = await prisma.organization.create({
      data: {
        name: `Ingest Org ${stamp}`,
        slug: `ingest-org-${stamp}`,
        plan: "FREE",
        eventAllowance: 2,
        memberships: { create: { userId: manager.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;
    await applyPlanSkuToOrg(org.id, "free");

    const event = await prisma.event.create({
      data: {
        name: `Ingest Event ${stamp}`,
        slug: `ingest-event-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2027-09-01T14:00:00Z"),
        endDate: new Date("2027-09-10T22:00:00Z"),
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

    const published = await prisma.session.create({
      data: {
        eventId: event.id,
        title: "Already Live Keynote",
        startsAt: new Date("2027-09-08T15:00:00Z"),
        endsAt: new Date("2027-09-08T16:00:00Z"),
        publishStatus: SessionPublishStatus.PUBLISHED,
      },
    });
    ids.publishedSessionId = published.id;
  });

  afterAll(async () => {
    if (!dbReady) {
      await prisma.$disconnect();
      return;
    }
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
      await prisma.event.delete({ where: { id: ids.eventId } });
    }
    if (ids.orgId) {
      await prisma.orgMembership.deleteMany({ where: { organizationId: ids.orgId } });
      await prisma.organization.delete({ where: { id: ids.orgId } }).catch(() => undefined);
    }
    if (ids.managerId) await prisma.user.delete({ where: { id: ids.managerId } }).catch(() => undefined);
    if (ids.attendeeId) await prisma.user.delete({ where: { id: ids.attendeeId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("existing published session on ACTIVE event stays attendee-visible", async () => {
    if (!dbReady) return;
    const session = await prisma.session.findUniqueOrThrow({
      where: { id: ids.publishedSessionId! },
    });
    const event = await prisma.event.findUniqueOrThrow({ where: { id: ids.eventId! } });
    expect(
      isSessionAttendeeVisible({
        canManageEvent: false,
        eventStatus: event.status,
        publishStatus: session.publishStatus,
      }),
    ).toBe(true);

    const visible = await prisma.session.findMany({
      where: {
        eventId: ids.eventId!,
        publishStatus: SessionPublishStatus.PUBLISHED,
        event: { status: EventStatus.ACTIVE },
      },
    });
    expect(visible.some((s) => s.id === ids.publishedSessionId)).toBe(true);
  });

  it("100% of writes gated behind confirm (extract creates zero sessions)", async () => {
    if (!dbReady) return;
    const before = await prisma.session.count({ where: { eventId: ids.eventId! } });
    const source = loadFixtureSource("docx-tracks");
    const extracted = await runAgendaExtract({
      organizationId: ids.orgId!,
      eventId: ids.eventId!,
      userId: ids.managerId,
      sourceText: source,
      eventTimezone: "UTC",
      existingSessions: [],
      skipCap: true,
      skipMetering: true,
      skipAudit: true,
    });
    const mid = await prisma.session.count({ where: { eventId: ids.eventId! } });
    expect(mid).toBe(before);
    expect(extracted.changeset.every((r) => r.kind === "create")).toBe(true);

    const run = await prisma.agendaIngestRun.create({
      data: {
        organizationId: ids.orgId!,
        eventId: ids.eventId!,
        createdById: ids.managerId,
        sourceKind: "DOCX",
        status: "READY_FOR_REVIEW",
        extraction: extracted.extraction as object,
        assumptions: extracted.assumptions as object[],
        changeset: extracted.changeset as object[],
        sourceTextPreview: extracted.sourcePreview,
      },
    });

    const confirmed = await confirmAgendaChangeset({
      prisma,
      organizationId: ids.orgId!,
      eventId: ids.eventId!,
      timezone: "UTC",
      actorUserId: ids.managerId,
      runId: run.id,
      rows: extracted.changeset,
    });
    expect(confirmed.createdCount).toBe(extracted.extraction.sessions.length);
    const drafts = await prisma.session.findMany({
      where: { eventId: ids.eventId!, publishStatus: SessionPublishStatus.DRAFT },
      include: { items: { include: { authors: { orderBy: { sortOrder: "asc" } } } } },
    });
    expect(drafts.length).toBe(confirmed.createdCount);
    // Author order preserved on paper session
    const paper = drafts.find((s) => s.title === "Clinical Case Conference");
    expect(paper?.items[0]?.authors.map((a) => a.name)).toEqual([
      "Mei Tan",
      "Jordan Blake",
      "Sam Ortiz",
    ]);

    // Attendee must not see drafts
    expect(
      isSessionAttendeeVisible({
        canManageEvent: false,
        eventStatus: EventStatus.ACTIVE,
        publishStatus: SessionPublishStatus.DRAFT,
      }),
    ).toBe(false);
  });

  it("re-import of modified fixture yields updates not duplicates", async () => {
    if (!dbReady) return;
    const existing = await prisma.session.findMany({
      where: { eventId: ids.eventId!, title: { startsWith: "Clinical" } },
      include: { track: true, room: true },
    });
    expect(existing.length).toBeGreaterThan(0);

    const source = loadFixtureSource("docx-tracks");
    const extracted = await runAgendaExtract({
      organizationId: ids.orgId!,
      eventId: ids.eventId!,
      userId: ids.managerId,
      sourceText: source,
      eventTimezone: "UTC",
      existingSessions: existing.map((s) => ({
        id: s.id,
        title: s.title,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        location: s.location,
        trackName: s.track?.name,
        roomName: s.room?.name,
      })),
      skipCap: true,
      skipMetering: true,
      skipAudit: true,
    });

    const updates = extracted.changeset.filter((r) => r.kind === "update");
    const createsForExistingTitles = extracted.changeset.filter(
      (r) => r.kind === "create" && existing.some((e) => e.title === r.session.title),
    );
    expect(updates.length).toBeGreaterThan(0);
    expect(createsForExistingTitles.length).toBe(0);
  });

  it("job handler extracts fixture and FREE second ingest shows upgrade", async () => {
    if (!dbReady) return;

    // Use a fresh event so AGENDA_INGEST usage starts at 0
    const stamp = Date.now();
    const event2 = await prisma.event.create({
      data: {
        name: `Ingest Cap ${stamp}`,
        slug: `ingest-cap-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2027-10-01T14:00:00Z"),
        endDate: new Date("2027-10-02T22:00:00Z"),
        status: EventStatus.ACTIVE,
        organizationId: ids.orgId!,
        createdById: ids.managerId!,
        memberships: { create: { userId: ids.managerId!, role: EventMemberRole.ADMIN } },
      },
    });

    const run = await prisma.agendaIngestRun.create({
      data: {
        organizationId: ids.orgId!,
        eventId: event2.id,
        createdById: ids.managerId,
        sourceKind: "PASTE",
        status: "PENDING",
        sourceTextPreview: loadFixtureSource("html-page").slice(0, 500),
      },
    });

    await enqueueJob({
      type: AGENDA_INGEST_JOB_TYPE,
      organizationId: ids.orgId!,
      eventId: event2.id,
      createdById: ids.managerId,
      payload: { runId: run.id, sourceText: loadFixtureSource("html-page") },
      maxAttempts: 1,
    });
    await processDueJobs(5);

    const ready = await prisma.agendaIngestRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(ready.status).toBe("READY_FOR_REVIEW");
    expect(Array.isArray(ready.changeset)).toBe(true);

    await expect(assertAiCap(ids.orgId!, event2.id, "AGENDA_INGEST")).rejects.toBeInstanceOf(HttpError);
    try {
      await assertAiCap(ids.orgId!, event2.id, "AGENDA_INGEST");
    } catch (err) {
      const body = (err as HttpError).body as { upgrade?: { code?: string } };
      expect(body.upgrade?.code).toBe("PLAN_LIMIT");
    }

    await prisma.agendaIngestRun.deleteMany({ where: { eventId: event2.id } });
    await prisma.backgroundJob.deleteMany({ where: { eventId: event2.id } });
    await prisma.aiUsageRecord.deleteMany({ where: { eventId: event2.id } });
    await prisma.auditLog.deleteMany({ where: { eventId: event2.id } });
    await prisma.eventMembership.deleteMany({ where: { eventId: event2.id } });
    await prisma.event.delete({ where: { id: event2.id } });
  });
});
