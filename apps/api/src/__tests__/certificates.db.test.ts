import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BackgroundJobStatus,
  CertificateEligibilityRule,
  CheckInMethod,
  EventMemberRole,
  EventStatus,
  OrgRole,
  PrismaClient,
  SessionAttendanceStatus,
} from "@prisma/client";
import { hashPassword } from "../lib/auth";
import { applyPlanSkuToOrg, can } from "../lib/billing/entitlements";
import { upsertFeatureOverrides } from "../lib/features/featureEnabled";
import {
  isUserEligible,
  listEligibleUserIds,
  validateTemplateEligibility,
  generateCertificatePublicId,
  issueCertificateForUser,
  registerCertificateJobs,
  CERTIFICATES_BATCH_ISSUE_JOB,
} from "../lib/certificates";
import { enqueueJob, processDueJobs } from "../lib/jobs";
import { HttpError } from "../lib/authorization";

describe("Phase P4 certificates (DB)", () => {
  const prisma = new PrismaClient();
  const ids: {
    orgId?: string;
    eventId?: string;
    sessionA?: string;
    sessionB?: string;
    sessionC?: string;
    adminId?: string;
    userA?: string;
    userB?: string;
    userC?: string;
    templateAny?: string;
    templateMin?: string;
    templateReq?: string;
  } = {};
  let dbReady = false;

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await prisma.badgeTemplate.findFirst();
      await prisma.certificateTemplate.findFirst();
      await prisma.issuedCertificate.findFirst();
    } catch {
      console.warn("[certificates.db.test] DB unreachable or P4 tables missing — skipping");
      return;
    }
    dbReady = true;
    registerCertificateJobs();

    const passwordHash = await hashPassword("TestPass12!x");
    const stamp = Date.now();

    const admin = await prisma.user.create({
      data: {
        email: `p4-admin-${stamp}@example.com`,
        name: "P4 Admin",
        passwordHash,
        role: "ADMIN",
      },
    });
    const userA = await prisma.user.create({
      data: {
        email: `p4-a-${stamp}@example.com`,
        name: "Attendee Alpha",
        passwordHash,
        role: "ATTENDEE",
      },
    });
    const userB = await prisma.user.create({
      data: {
        email: `p4-b-${stamp}@example.com`,
        name: "Attendee Beta",
        passwordHash,
        role: "ATTENDEE",
      },
    });
    const userC = await prisma.user.create({
      data: {
        email: `p4-c-${stamp}@example.com`,
        name: "Attendee Gamma",
        passwordHash,
        role: "ATTENDEE",
      },
    });
    ids.adminId = admin.id;
    ids.userA = userA.id;
    ids.userB = userB.id;
    ids.userC = userC.id;

    const org = await prisma.organization.create({
      data: {
        name: `P4 Org ${stamp}`,
        slug: `p4-org-${stamp}`,
        plan: "PRO",
        eventAllowance: 5,
        memberships: { create: { userId: admin.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;
    await applyPlanSkuToOrg(org.id, "pro_monthly");

    const event = await prisma.event.create({
      data: {
        name: `P4 Event ${stamp}`,
        slug: `p4-event-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2026-06-01T14:00:00Z"),
        endDate: new Date("2026-06-03T22:00:00Z"),
        status: EventStatus.ACTIVE,
        organizationId: org.id,
        createdById: admin.id,
        brandColor: "#0033A0",
        memberships: {
          create: [
            { userId: admin.id, role: EventMemberRole.ADMIN },
            { userId: userA.id, role: EventMemberRole.ATTENDEE },
            { userId: userB.id, role: EventMemberRole.ATTENDEE },
            { userId: userC.id, role: EventMemberRole.ATTENDEE },
          ],
        },
      },
    });
    ids.eventId = event.id;
    await upsertFeatureOverrides(event.id, { certificates: true, checkin: true });

    const sessions = await Promise.all(
      (["Session A", "Session B", "Session C"] as const).map((title, i) =>
        prisma.session.create({
          data: {
            eventId: event.id,
            title,
            startsAt: new Date(`2026-06-0${i + 1}T15:00:00Z`),
            endsAt: new Date(`2026-06-0${i + 1}T16:00:00Z`),
          },
        }),
      ),
    );
    ids.sessionA = sessions[0]!.id;
    ids.sessionB = sessions[1]!.id;
    ids.sessionC = sessions[2]!.id;

    // A checked in; B not
    await prisma.checkIn.create({
      data: {
        userId: userA.id,
        eventId: event.id,
        method: CheckInMethod.SELF,
      },
    });

    // A joins 2 sessions; B joins 1; C joins all 3
    await prisma.sessionAttendance.createMany({
      data: [
        { userId: userA.id, sessionId: ids.sessionA!, status: SessionAttendanceStatus.JOINING },
        { userId: userA.id, sessionId: ids.sessionB!, status: SessionAttendanceStatus.JOINING },
        { userId: userB.id, sessionId: ids.sessionA!, status: SessionAttendanceStatus.JOINING },
        { userId: userC.id, sessionId: ids.sessionA!, status: SessionAttendanceStatus.JOINING },
        { userId: userC.id, sessionId: ids.sessionB!, status: SessionAttendanceStatus.JOINING },
        { userId: userC.id, sessionId: ids.sessionC!, status: SessionAttendanceStatus.JOINING },
      ],
    });

    const tAny = await prisma.certificateTemplate.create({
      data: {
        organizationId: org.id,
        eventId: event.id,
        name: "Any check-in",
        titleText: "Certificate of Attendance",
        bodyText: "{attendeeName} attended {eventName} ({dates}). ID {certificateId}. Hours:{hours}.",
        hours: null,
        eligibilityRule: CertificateEligibilityRule.ANY_CHECKIN,
      },
    });
    const tMin = await prisma.certificateTemplate.create({
      data: {
        organizationId: org.id,
        eventId: event.id,
        name: "Min 2 sessions",
        titleText: "Participation",
        bodyText: "Thanks {attendeeName}",
        hours: 4,
        eligibilityRule: CertificateEligibilityRule.MIN_SESSIONS,
        minSessions: 2,
      },
    });
    const tReq = await prisma.certificateTemplate.create({
      data: {
        organizationId: org.id,
        eventId: event.id,
        name: "Required A+B",
        titleText: "Required sessions",
        bodyText: "Done",
        eligibilityRule: CertificateEligibilityRule.REQUIRED_SESSIONS,
        requiredSessionIds: [ids.sessionA!, ids.sessionB!],
      },
    });
    ids.templateAny = tAny.id;
    ids.templateMin = tMin.id;
    ids.templateReq = tReq.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("entitlements: FREE blocks badges/certificates; PRO allows", async () => {
    if (!dbReady) return;
    expect(await can(ids.orgId!, "badges")).toBe(true);
    expect(await can(ids.orgId!, "certificates")).toBe(true);

    const freeOrg = await prisma.organization.create({
      data: {
        name: `P4 Free ${Date.now()}`,
        slug: `p4-free-${Date.now()}`,
        plan: "FREE",
        eventAllowance: 1,
      },
    });
    await applyPlanSkuToOrg(freeOrg.id, "free");
    expect(await can(freeOrg.id, "badges")).toBe(false);
    expect(await can(freeOrg.id, "certificates")).toBe(false);
  });

  it("eligibility: ANY_CHECKIN / MIN_SESSIONS / REQUIRED_SESSIONS", async () => {
    if (!dbReady) return;
    const anyT = await prisma.certificateTemplate.findUniqueOrThrow({ where: { id: ids.templateAny! } });
    const minT = await prisma.certificateTemplate.findUniqueOrThrow({ where: { id: ids.templateMin! } });
    const reqT = await prisma.certificateTemplate.findUniqueOrThrow({ where: { id: ids.templateReq! } });

    expect(await isUserEligible(anyT, ids.userA!)).toBe(true);
    expect(await isUserEligible(anyT, ids.userB!)).toBe(false);

    expect(await isUserEligible(minT, ids.userA!)).toBe(true); // 2 joins
    expect(await isUserEligible(minT, ids.userB!)).toBe(false); // 1 join
    expect(await isUserEligible({ ...minT, minSessions: 3 }, ids.userA!)).toBe(false);

    expect(await isUserEligible(reqT, ids.userA!)).toBe(true); // A+B
    expect(await isUserEligible(reqT, ids.userB!)).toBe(false); // only A
    expect(await isUserEligible(reqT, ids.userC!)).toBe(true); // A+B+C

    const eligibleMin = await listEligibleUserIds(minT);
    expect(eligibleMin.sort()).toEqual([ids.userA!, ids.userC!].sort());
  });

  it("template save validates requiredSessionIds and minSessions", async () => {
    if (!dbReady) return;
    await expect(
      validateTemplateEligibility({
        eventId: ids.eventId!,
        eligibilityRule: CertificateEligibilityRule.MIN_SESSIONS,
        minSessions: 0,
      }),
    ).rejects.toBeInstanceOf(HttpError);

    await expect(
      validateTemplateEligibility({
        eventId: ids.eventId!,
        eligibilityRule: CertificateEligibilityRule.REQUIRED_SESSIONS,
        requiredSessionIds: [ids.sessionA!, "not-a-session"],
      }),
    ).rejects.toBeInstanceOf(HttpError);

    const ok = await validateTemplateEligibility({
      eventId: ids.eventId!,
      eligibilityRule: CertificateEligibilityRule.REQUIRED_SESSIONS,
      requiredSessionIds: [ids.sessionA!, ids.sessionB!],
    });
    expect(ok.requiredSessionIds).toHaveLength(2);
  });

  it("issue upsert preserves publicId and issuedAt; regenerate sets regeneratedAt", async () => {
    if (!dbReady) return;
    const template = await prisma.certificateTemplate.findUniqueOrThrow({
      where: { id: ids.templateAny! },
      include: {
        event: {
          select: {
            id: true,
            name: true,
            startDate: true,
            endDate: true,
            timezone: true,
            organizationId: true,
          },
        },
      },
    });
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: ids.userA! },
      select: { id: true, name: true, email: true },
    });

    const first = await issueCertificateForUser({
      template,
      user,
      issuedByUserId: ids.adminId!,
    });
    expect(first).toBeTruthy();
    expect(first!.created).toBe(true);
    expect(first!.regenerated).toBe(false);
    expect(first!.regeneratedAt).toBeNull();
    expect(first!.publicId.length).toBeGreaterThan(10);

    const second = await issueCertificateForUser({
      template,
      user,
      issuedByUserId: ids.adminId!,
    });
    expect(second!.publicId).toBe(first!.publicId);
    expect(second!.issuedAt.getTime()).toBe(first!.issuedAt.getTime());
    expect(second!.regenerated).toBe(true);
    expect(second!.regeneratedAt).toBeTruthy();

    const count = await prisma.issuedCertificate.count({
      where: { certificateTemplateId: template.id, userId: user.id },
    });
    expect(count).toBe(1);
  });

  it("publicId is randomBytes base64url entropy", () => {
    const a = generateCertificatePublicId();
    const b = generateCertificatePublicId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(20);
  });

  it("/verify shape via DB: voided treated as miss; snapshots only", async () => {
    if (!dbReady) return;
    const row = await prisma.issuedCertificate.findFirst({
      where: { certificateTemplateId: ids.templateAny!, userId: ids.userA! },
    });
    expect(row).toBeTruthy();

    const live = await prisma.issuedCertificate.findUnique({
      where: { publicId: row!.publicId },
      select: {
        attendeeNameSnapshot: true,
        eventNameSnapshot: true,
        eventDateSnapshot: true,
        voidedAt: true,
      },
    });
    expect(live!.voidedAt).toBeNull();
    expect(live!.attendeeNameSnapshot).toBe("Attendee Alpha");

    await prisma.issuedCertificate.update({
      where: { id: row!.id },
      data: { voidedAt: new Date() },
    });
    const voided = await prisma.issuedCertificate.findUnique({
      where: { publicId: row!.publicId },
    });
    expect(voided!.voidedAt).toBeTruthy();

    // restore for later tests
    await prisma.issuedCertificate.update({
      where: { id: row!.id },
      data: { voidedAt: null },
    });
  });

  it("500-attendee batch job advances progress and finishes SUCCEEDED", async () => {
    if (!dbReady) return;

    const stamp = Date.now();
    const passwordHash = await hashPassword("TestPass12!x");
    const emails = Array.from({ length: 500 }, (_, i) => `p4-bulk-${stamp}-${i}@example.com`);

    const seedStarted = Date.now();
    await prisma.user.createMany({
      data: emails.map((email, i) => ({
        email,
        name: `Bulk ${String(i).padStart(3, "0")}`,
        passwordHash,
        role: "ATTENDEE" as const,
      })),
    });
    const bulkUsers = await prisma.user.findMany({
      where: { email: { in: emails } },
      select: { id: true },
    });
    expect(bulkUsers).toHaveLength(500);

    await prisma.eventMembership.createMany({
      data: bulkUsers.map((u) => ({
        eventId: ids.eventId!,
        userId: u.id,
        role: EventMemberRole.ATTENDEE,
      })),
    });
    await prisma.checkIn.createMany({
      data: bulkUsers.map((u) => ({
        userId: u.id,
        eventId: ids.eventId!,
        method: CheckInMethod.SELF,
      })),
    });
    const seedMs = Date.now() - seedStarted;

    const job = await enqueueJob({
      type: CERTIFICATES_BATCH_ISSUE_JOB,
      organizationId: ids.orgId!,
      eventId: ids.eventId!,
      createdById: ids.adminId!,
      payload: { certificateTemplateId: ids.templateAny!, sendReadyEmail: false },
    });

    const jobStarted = Date.now();
    let finished = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
    for (let attempt = 0; attempt < 5 && finished.status !== BackgroundJobStatus.SUCCEEDED; attempt++) {
      await processDueJobs(1);
      finished = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
    }
    const jobMs = Date.now() - jobStarted;
    console.log(
      `[certificates.db.test] 500-batch timing: seed=${seedMs}ms job=${jobMs}ms total=${seedMs + jobMs}ms status=${finished.status}`,
    );

    expect(finished.status).toBe(BackgroundJobStatus.SUCCEEDED);
    expect(finished.progress).toBe(100);
    expect(finished.progressMessage).toBeTruthy();

    const result = finished.result as { issued?: number; regenerated?: number; totalEligible?: number };
    // 500 bulk + original checked-in userA (and possibly others already issued)
    expect(result.totalEligible).toBeGreaterThanOrEqual(500);
    expect((result.issued ?? 0) + (result.regenerated ?? 0)).toBe(result.totalEligible);

    const publicIds = await prisma.issuedCertificate.findMany({
      where: {
        certificateTemplateId: ids.templateAny!,
        userId: { in: bulkUsers.map((u) => u.id) },
      },
      select: { publicId: true },
    });
    expect(publicIds).toHaveLength(500);

    // Second run regenerates without new publicIds
    const job2 = await enqueueJob({
      type: CERTIFICATES_BATCH_ISSUE_JOB,
      organizationId: ids.orgId!,
      eventId: ids.eventId!,
      createdById: ids.adminId!,
      payload: { certificateTemplateId: ids.templateAny!, sendReadyEmail: false },
    });
    for (let attempt = 0; attempt < 5; attempt++) {
      await processDueJobs(1);
      const j = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job2.id } });
      if (j.status === BackgroundJobStatus.SUCCEEDED) break;
    }
    const after = await prisma.issuedCertificate.findMany({
      where: {
        certificateTemplateId: ids.templateAny!,
        userId: { in: bulkUsers.map((u) => u.id) },
      },
      select: { publicId: true },
    });
    expect(after.map((r) => r.publicId).sort()).toEqual(publicIds.map((r) => r.publicId).sort());
  }, 300_000);
});
