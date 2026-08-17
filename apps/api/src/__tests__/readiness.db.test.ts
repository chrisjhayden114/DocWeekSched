import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EventMemberRole, OrgRole, PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/auth";
import { HttpError, requireEventAccess } from "../lib/authorization";
import { featureEnabled, requireFeature, upsertFeatureOverrides } from "../lib/features";
import {
  assignTemplate,
  createRequirement,
  createTemplate,
  deleteTemplate,
  getReadinessActivity,
  getReadinessOverview,
  updateAssignment,
  updateRequirement,
  updateTemplate,
} from "../lib/readiness/service";

/**
 * ER2 — readiness data layer. Every /readiness route resolves the event,
 * gates on the hidden `readiness` feature (404 when off), requires
 * manage-level access (403 for outsiders), and re-scopes every row lookup by
 * the resolved event id (404 for real ids from another event). These tests
 * exercise exactly those layers the way the routes compose them.
 */
describe("readiness data layer (DB, ER2)", () => {
  const prisma = new PrismaClient();
  const ids: {
    adminA?: string;
    attendeeA?: string;
    managerB?: string;
    orgA?: string;
    orgB?: string;
    eventA?: string;
    eventB?: string;
    speaker1?: string;
    speaker2?: string;
    speakerB?: string;
    sessionA?: string;
    templateA?: string;
    reqNoDue?: string;
    reqPastDue?: string;
  } = {};
  /** Existing-record snapshot: readiness must write nothing outside Readiness* + AuditLog. */
  let untouchedSnapshot = "";

  const snapshotUntouched = async () => {
    const [speakers, sessions, events] = await Promise.all([
      prisma.speaker.findMany({
        where: { eventId: { in: [ids.eventA!, ids.eventB!] } },
        orderBy: { id: "asc" },
      }),
      prisma.session.findMany({
        where: { eventId: { in: [ids.eventA!, ids.eventB!] } },
        orderBy: { id: "asc" },
      }),
      prisma.event.findMany({
        where: { id: { in: [ids.eventA!, ids.eventB!] } },
        orderBy: { id: "asc" },
      }),
    ]);
    return JSON.stringify({ speakers, sessions, events });
  };

  beforeAll(async () => {
    const stamp = Date.now();
    const passwordHash = await hashPassword("TestPass12!x");

    const adminA = await prisma.user.create({
      data: { email: `rdy-admin-a-${stamp}@example.com`, name: "Readiness Admin A", passwordHash, role: "ADMIN" },
    });
    const managerB = await prisma.user.create({
      data: { email: `rdy-mgr-b-${stamp}@example.com`, name: "Readiness Manager B", passwordHash, role: "ADMIN" },
    });
    // ER3b — plain event ATTENDEE on event A: must never reach manage-gated
    // readiness surfaces (incl. GET /activity).
    const attendeeA = await prisma.user.create({
      data: { email: `rdy-att-a-${stamp}@example.com`, name: "Readiness Attendee A", passwordHash, role: "ATTENDEE" },
    });
    ids.adminA = adminA.id;
    ids.attendeeA = attendeeA.id;
    ids.managerB = managerB.id;

    // INTERNAL plan = the manual pilot gate; the feature still needs the
    // per-event override before requireFeature passes.
    const orgA = await prisma.organization.create({
      data: {
        name: `Readiness Org A ${stamp}`,
        slug: `rdy-a-${stamp}`,
        plan: "INTERNAL",
        memberships: { create: { userId: adminA.id, role: OrgRole.OWNER } },
      },
    });
    const orgB = await prisma.organization.create({
      data: {
        name: `Readiness Org B ${stamp}`,
        slug: `rdy-b-${stamp}`,
        plan: "INTERNAL",
        memberships: { create: { userId: managerB.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgA = orgA.id;
    ids.orgB = orgB.id;

    const eventA = await prisma.event.create({
      data: {
        name: `Readiness Event A ${stamp}`,
        slug: `rdy-evt-a-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2027-03-01T12:00:00Z"),
        endDate: new Date("2027-03-03T12:00:00Z"),
        organizationId: orgA.id,
        createdById: adminA.id,
        memberships: {
          create: [
            { userId: adminA.id, role: EventMemberRole.ADMIN },
            { userId: attendeeA.id, role: EventMemberRole.ATTENDEE },
          ],
        },
      },
    });
    const eventB = await prisma.event.create({
      data: {
        name: `Readiness Event B ${stamp}`,
        slug: `rdy-evt-b-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2027-04-01T12:00:00Z"),
        endDate: new Date("2027-04-03T12:00:00Z"),
        organizationId: orgB.id,
        createdById: managerB.id,
        memberships: { create: { userId: managerB.id, role: EventMemberRole.ADMIN } },
      },
    });
    ids.eventA = eventA.id;
    ids.eventB = eventB.id;

    const speaker1 = await prisma.speaker.create({
      data: { eventId: eventA.id, name: "Dr. Ada Keynote" },
    });
    const speaker2 = await prisma.speaker.create({
      data: { eventId: eventA.id, name: "Prof. Grace Panelist" },
    });
    const speakerB = await prisma.speaker.create({
      data: { eventId: eventB.id, name: "Other-Event Speaker" },
    });
    ids.speaker1 = speaker1.id;
    ids.speaker2 = speaker2.id;
    ids.speakerB = speakerB.id;

    const sessionA = await prisma.session.create({
      data: {
        eventId: eventA.id,
        title: "Opening Plenary",
        startsAt: new Date("2027-03-01T14:00:00Z"),
        endsAt: new Date("2027-03-01T15:00:00Z"),
      },
    });
    ids.sessionA = sessionA.id;

    untouchedSnapshot = await snapshotUntouched();
  }, 60_000);

  afterAll(async () => {
    const eventIds = [ids.eventA, ids.eventB].filter((x): x is string => Boolean(x));
    if (eventIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { eventId: { in: eventIds } } });
      await prisma.readinessSubmission.deleteMany({ where: { eventId: { in: eventIds } } });
      await prisma.readinessAssignment.deleteMany({ where: { eventId: { in: eventIds } } });
      await prisma.readinessRequirement.deleteMany({ where: { eventId: { in: eventIds } } });
      await prisma.readinessTemplate.deleteMany({ where: { eventId: { in: eventIds } } });
      await prisma.readinessPortalAccess.deleteMany({ where: { eventId: { in: eventIds } } });
      await prisma.session.deleteMany({ where: { eventId: { in: eventIds } } });
      await prisma.speaker.deleteMany({ where: { eventId: { in: eventIds } } });
      await prisma.eventFeatureConfig.deleteMany({ where: { eventId: { in: eventIds } } });
      await prisma.eventMembership.deleteMany({ where: { eventId: { in: eventIds } } });
      await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    }
    for (const orgId of [ids.orgA, ids.orgB]) {
      if (!orgId) continue;
      await prisma.orgMembership.deleteMany({ where: { organizationId: orgId } });
      await prisma.organization.deleteMany({ where: { id: orgId } });
    }
    for (const userId of [ids.adminA, ids.attendeeA, ids.managerB]) {
      if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    }
    await prisma.$disconnect();
  }, 60_000);

  it("feature off: every route's shared gate 404s before any data access", async () => {
    // No override yet — even the INTERNAL entitlement is not enough.
    expect(await featureEnabled(ids.eventA!, "readiness")).toBe(false);
    await expect(requireFeature(ids.eventA!, "readiness")).rejects.toMatchObject({
      status: 404,
    } satisfies Partial<HttpError>);
  }, 60_000);

  it("with the override on: template → requirements → assign (idempotent)", async () => {
    await upsertFeatureOverrides(ids.eventA!, { readiness: true });
    await upsertFeatureOverrides(ids.eventB!, { readiness: true });
    await expect(requireFeature(ids.eventA!, "readiness")).resolves.toBeUndefined();

    const template = await createTemplate(ids.eventA!, ids.orgA!, {
      name: "Paper presenter",
      description: "Everything a presenter owes us before the program locks.",
    });
    ids.templateA = template.id;

    // Duplicate name in the same event → 400 (unique [eventId, name]).
    await expect(
      createTemplate(ids.eventA!, ids.orgA!, { name: "Paper presenter" }),
    ).rejects.toMatchObject({ status: 400 });

    const reqNoDue = await createRequirement(ids.eventA!, template.id, {
      label: "Confirm attendance",
      kind: "confirm",
      sortOrder: 0,
    });
    const reqPastDue = await createRequirement(ids.eventA!, template.id, {
      label: "Upload slides",
      kind: "file",
      dueAt: new Date("2020-01-01T00:00:00Z"), // long past → derives late until settled
      sortOrder: 1,
    });
    ids.reqNoDue = reqNoDue.id;
    ids.reqPastDue = reqPastDue.id;

    // 2 requirements × (2 speakers + 1 session) = 6 assignments.
    const first = await assignTemplate(ids.eventA!, ids.orgA!, template.id, {
      speakerIds: [ids.speaker1!, ids.speaker2!],
      sessionIds: [ids.sessionA!],
    });
    expect(first).toEqual({ created: 6, skipped: 0 });

    // Re-running is a no-op, not a duplicate pile.
    const second = await assignTemplate(ids.eventA!, ids.orgA!, template.id, {
      speakerIds: [ids.speaker1!, ids.speaker2!],
      sessionIds: [ids.sessionA!],
    });
    expect(second).toEqual({ created: 0, skipped: 6 });
  }, 60_000);

  it("overview: NOT_STARTED assignments, subject display info, derived rollups", async () => {
    const overview = await getReadinessOverview(ids.eventA!);
    expect(overview.templates).toHaveLength(1);
    expect(overview.templates[0]!.requirements).toHaveLength(2);
    expect(overview.assignments).toHaveLength(6);
    expect(overview.assignments.every((a) => a.status === "NOT_STARTED")).toBe(true);

    // Subject display info comes joined in — speaker names and session title.
    const names = overview.subjects.map((s) => s.name).sort();
    expect(names).toEqual(["Dr. Ada Keynote", "Opening Plenary", "Prof. Grace Panelist"]);

    // Each subject: 2 open, 1 late (the past-due requirement), incomplete.
    for (const subject of overview.subjects) {
      expect(subject.rollup).toEqual({
        total: 2,
        ready: 0,
        waived: 0,
        open: 2,
        late: 1,
        complete: false,
      });
    }
    const lateOnes = overview.assignments.filter((a) => a.late);
    expect(lateOnes).toHaveLength(3);
    expect(lateOnes.every((a) => a.requirementId === ids.reqPastDue)).toBe(true);
  }, 60_000);

  it("PATCH to READY updates the rollup and clears derived lateness", async () => {
    const lateAssignment = await prisma.readinessAssignment.findFirstOrThrow({
      where: { eventId: ids.eventA!, speakerId: ids.speaker1!, requirementId: ids.reqPastDue! },
    });
    await updateAssignment(ids.eventA!, lateAssignment.id, { status: "READY" }, ids.adminA!);

    let overview = await getReadinessOverview(ids.eventA!);
    let subject = overview.subjects.find((s) => s.type === "speaker" && s.id === ids.speaker1)!;
    // Late cleared by READY; one requirement still open.
    expect(subject.rollup).toEqual({
      total: 2,
      ready: 1,
      waived: 0,
      open: 1,
      late: 0,
      complete: false,
    });

    const remaining = await prisma.readinessAssignment.findFirstOrThrow({
      where: { eventId: ids.eventA!, speakerId: ids.speaker1!, requirementId: ids.reqNoDue! },
    });
    await updateAssignment(ids.eventA!, remaining.id, { status: "READY" }, ids.adminA!);

    overview = await getReadinessOverview(ids.eventA!);
    subject = overview.subjects.find((s) => s.type === "speaker" && s.id === ids.speaker1)!;
    expect(subject.rollup).toEqual({
      total: 2,
      ready: 2,
      waived: 0,
      open: 0,
      late: 0,
      complete: true,
    });
  }, 60_000);

  it("WAIVED stamps waivedAt/waivedById and writes an audit row; un-waiving clears both", async () => {
    const assignment = await prisma.readinessAssignment.findFirstOrThrow({
      where: { eventId: ids.eventA!, speakerId: ids.speaker2!, requirementId: ids.reqNoDue! },
    });

    const waived = await updateAssignment(
      ids.eventA!,
      assignment.id,
      { status: "WAIVED" },
      ids.adminA!,
    );
    expect(waived.status).toBe("WAIVED");
    expect(waived.waivedAt).toBeInstanceOf(Date);
    expect(waived.waivedById).toBe(ids.adminA);

    const auditAfterWaive = await prisma.auditLog.findMany({
      where: { eventId: ids.eventA!, entityType: "ReadinessAssignment", entityId: assignment.id },
      orderBy: { createdAt: "asc" },
    });
    expect(auditAfterWaive).toHaveLength(1);
    expect(auditAfterWaive[0]!.action).toBe("OTHER");
    expect(auditAfterWaive[0]!.actorUserId).toBe(ids.adminA);
    expect(auditAfterWaive[0]!.organizationId).toBe(ids.orgA);
    expect(auditAfterWaive[0]!.payload).toMatchObject({ action: "waive", toStatus: "WAIVED" });

    const unwaived = await updateAssignment(
      ids.eventA!,
      assignment.id,
      { status: "NOT_STARTED" },
      ids.adminA!,
    );
    expect(unwaived.status).toBe("NOT_STARTED");
    expect(unwaived.waivedAt).toBeNull();
    expect(unwaived.waivedById).toBeNull();

    const auditAfterUnwaive = await prisma.auditLog.findMany({
      where: { eventId: ids.eventA!, entityType: "ReadinessAssignment", entityId: assignment.id },
      orderBy: { createdAt: "asc" },
    });
    expect(auditAfterUnwaive).toHaveLength(2);
    expect(auditAfterUnwaive[1]!.payload).toMatchObject({ action: "unwaive", fromStatus: "WAIVED" });
  }, 60_000);

  it("activity: waive + un-waive read back as two newest-first plain-English entries", async () => {
    // The previous test waived then un-waived Grace's "Confirm attendance" —
    // the only two AuditLog writes so far in event A.
    const entries = await getReadinessActivity(ids.eventA!);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.summary)).toEqual([
      "Un-waived “Confirm attendance” for Prof. Grace Panelist",
      "Waived “Confirm attendance” for Prof. Grace Panelist",
    ]);
    for (const entry of entries) {
      expect(entry.actorName).toBe("Readiness Admin A");
      expect(entry.at).toBeInstanceOf(Date);
    }
    // Newest first.
    expect(entries[0]!.at.getTime()).toBeGreaterThanOrEqual(entries[1]!.at.getTime());
  }, 60_000);

  it("activity: an event ATTENDEE fails the manage gate the /activity route uses", async () => {
    await expect(
      requireEventAccess(ids.attendeeA!, ids.eventA!, { manage: true }),
    ).rejects.toMatchObject({ status: 403 } satisfies Partial<HttpError>);
  }, 60_000);

  it("activity: other-event isolation — event B sees none of event A's entries", async () => {
    expect(await getReadinessActivity(ids.eventB!)).toEqual([]);
  }, 60_000);

  it("tenant isolation: event B's manager cannot touch event A by id", async () => {
    // Route guard: manager of event B holds no access on event A at all → 403.
    await expect(
      requireEventAccess(ids.managerB!, ids.eventA!, { manage: true }),
    ).rejects.toMatchObject({ status: 403 });

    // Even a manager scoped to their own event gets 404 for event A's real ids —
    // every service lookup is re-scoped by the resolved event.
    const anyAssignment = await prisma.readinessAssignment.findFirstOrThrow({
      where: { eventId: ids.eventA! },
    });
    await expect(updateTemplate(ids.eventB!, ids.templateA!, { name: "X" })).rejects.toMatchObject(
      { status: 404 },
    );
    await expect(
      createRequirement(ids.eventB!, ids.templateA!, { label: "X", kind: "confirm" }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      updateRequirement(ids.eventB!, ids.reqNoDue!, { label: "X" }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      updateAssignment(ids.eventB!, anyAssignment.id, { status: "READY" }, ids.managerB!),
    ).rejects.toMatchObject({ status: 404 });
    await expect(deleteTemplate(ids.eventB!, ids.templateA!)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      assignTemplate(ids.eventB!, ids.orgB!, ids.templateA!, { speakerIds: [ids.speakerB!] }),
    ).rejects.toMatchObject({ status: 404 });

    // Assigning a subject from another event is a 400, never a silent skip.
    await expect(
      assignTemplate(ids.eventA!, ids.orgA!, ids.templateA!, { speakerIds: [ids.speakerB!] }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      assignTemplate(ids.eventA!, ids.orgA!, ids.templateA!, {
        speakerIds: [ids.speaker1!, ids.speakerB!],
      }),
    ).rejects.toMatchObject({ status: 400 });

    // Nothing above created rows for the foreign subject.
    expect(
      await prisma.readinessAssignment.count({ where: { speakerId: ids.speakerB! } }),
    ).toBe(0);
  }, 60_000);

  it("existing event/speaker/session data is untouched by the whole workflow", async () => {
    expect(await snapshotUntouched()).toBe(untouchedSnapshot);
  }, 60_000);
});
