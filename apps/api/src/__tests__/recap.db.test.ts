/**
 * Phase A6 — Post-event recap (DB) — the 10 plan tests.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CertificateEligibilityRule,
  CheckInMethod,
  EventMemberRole,
  EventStatus,
  OrgRole,
  PrismaClient,
  RecapEmailStatus,
  RecapSectionStatus,
  SessionAttendanceStatus,
  SessionJoinMode,
  SessionPublishStatus,
} from "@prisma/client";
import { hashPassword } from "../lib/auth";
import { applyPlanSkuToOrg, can } from "../lib/billing/entitlements";
import { upsertFeatureOverrides } from "../lib/features/featureEnabled";
import { MockAiProvider, resetAiProviderForTests } from "../lib/ai/providers";
import {
  buildFeedbackQuoteBank,
  computeRecapMetrics,
  finalizeReportNarrative,
  generateEventRecap,
  mergeFixNextYearIntoChecklist,
  quoteIdForFeedback,
  registerRecapJobs,
  resolveSynthesisThemes,
  sendRecapEmail,
  RecapSectionError,
} from "../lib/ai/recap";
import { registerCertificateJobs } from "../lib/certificates";
import { processDueJobs } from "../lib/jobs";
import * as emailMod from "../lib/email";
import { cloneNextEdition } from "../lib/seriesClone";

describe("Phase A6 recap (DB)", () => {
  const prisma = new PrismaClient();
  const ids: {
    orgId?: string;
    freeOrgId?: string;
    eventId?: string;
    futureEventId?: string;
    seriesId?: string;
    sessionA?: string;
    sessionB?: string;
    adminId?: string;
    userA?: string;
    userB?: string;
    userC?: string;
    speakerId?: string;
    templateId?: string;
    feedbackId?: string;
  } = {};
  let dbReady = false;
  let emailSendSpy: ReturnType<typeof vi.fn> | null = null;

  beforeAll(async () => {
    process.env.AI_PROVIDER = "mock";
    resetAiProviderForTests(new MockAiProvider());

    try {
      await prisma.$queryRaw`SELECT 1`;
      await prisma.eventRecap.findFirst();
      await prisma.certificateTemplate.findFirst();
    } catch {
      console.warn("[recap.db.test] DB unreachable or A6 tables missing — skipping");
      return;
    }
    dbReady = true;
    registerRecapJobs();
    registerCertificateJobs();

    const passwordHash = await hashPassword("TestPass12!x");
    const stamp = Date.now();

    const admin = await prisma.user.create({
      data: { email: `a6-admin-${stamp}@example.com`, name: "A6 Admin", passwordHash, role: "ADMIN" },
    });
    const userA = await prisma.user.create({
      data: {
        email: `a6-a-${stamp}@example.com`,
        name: "Attendee Alpha",
        passwordHash,
        role: "ATTENDEE",
        engagementPoints: 40,
      },
    });
    const userB = await prisma.user.create({
      data: {
        email: `a6-b-${stamp}@example.com`,
        name: "Attendee Beta",
        passwordHash,
        role: "ATTENDEE",
        engagementPoints: 10,
      },
    });
    const userC = await prisma.user.create({
      data: {
        email: `a6-c-${stamp}@example.com`,
        name: "Attendee Gamma",
        passwordHash,
        role: "ATTENDEE",
        engagementPoints: 0,
      },
    });
    const speaker = await prisma.user.create({
      data: {
        email: `a6-spk-${stamp}@example.com`,
        name: "Speaker Sam",
        passwordHash,
        role: "ATTENDEE",
      },
    });
    ids.adminId = admin.id;
    ids.userA = userA.id;
    ids.userB = userB.id;
    ids.userC = userC.id;
    ids.speakerId = speaker.id;

    const org = await prisma.organization.create({
      data: {
        name: `A6 Org ${stamp}`,
        slug: `a6-org-${stamp}`,
        memberships: { create: { userId: admin.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;
    await applyPlanSkuToOrg(org.id, "pro_annual");

    const freeOrg = await prisma.organization.create({
      data: {
        name: `A6 Free ${stamp}`,
        slug: `a6-free-${stamp}`,
        memberships: { create: { userId: admin.id, role: OrgRole.OWNER } },
      },
    });
    ids.freeOrgId = freeOrg.id;
    await applyPlanSkuToOrg(freeOrg.id, "free");

    const series = await prisma.eventSeries.create({
      data: {
        organizationId: org.id,
        name: `A6 Series ${stamp}`,
        slug: `a6-series-${stamp}`,
        setupChecklist: [
          { key: "review_tracks", label: "Review tracks", done: false },
        ],
      },
    });
    ids.seriesId = series.id;

    const endDate = new Date(Date.now() - 60 * 60 * 1000);
    const startDate = new Date(endDate.getTime() - 2 * 24 * 60 * 60 * 1000);

    const event = await prisma.event.create({
      data: {
        name: `A6 Event ${stamp}`,
        slug: `a6-evt-${stamp}`,
        timezone: "UTC",
        startDate,
        endDate,
        status: EventStatus.ACTIVE,
        organizationId: org.id,
        createdById: admin.id,
        seriesId: series.id,
        memberships: {
          create: [
            { userId: admin.id, role: EventMemberRole.ADMIN },
            { userId: userA.id, role: EventMemberRole.ATTENDEE },
            { userId: userB.id, role: EventMemberRole.ATTENDEE },
            { userId: userC.id, role: EventMemberRole.ATTENDEE },
            { userId: speaker.id, role: EventMemberRole.SPEAKER },
          ],
        },
      },
    });
    ids.eventId = event.id;
    await upsertFeatureOverrides(event.id, {
      recap_agent: true,
      certificates: true,
      session_feedback: true,
      session_polls: true,
      checkin: true,
      sponsors: true,
    });

    const futureEvent = await prisma.event.create({
      data: {
        name: `A6 Future ${stamp}`,
        slug: `a6-future-${stamp}`,
        timezone: "UTC",
        startDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() + 48 * 60 * 60 * 1000),
        status: EventStatus.ACTIVE,
        organizationId: org.id,
        createdById: admin.id,
        memberships: { create: { userId: admin.id, role: EventMemberRole.ADMIN } },
      },
    });
    ids.futureEventId = futureEvent.id;
    await upsertFeatureOverrides(futureEvent.id, { recap_agent: true });

    const sessionA = await prisma.session.create({
      data: {
        eventId: event.id,
        title: "Session Alpha",
        publishStatus: SessionPublishStatus.PUBLISHED,
        startsAt: new Date(startDate.getTime() + 60 * 60 * 1000),
        endsAt: new Date(startDate.getTime() + 2 * 60 * 60 * 1000),
      },
    });
    const sessionB = await prisma.session.create({
      data: {
        eventId: event.id,
        title: "Session Beta",
        publishStatus: SessionPublishStatus.PUBLISHED,
        startsAt: new Date(startDate.getTime() + 3 * 60 * 60 * 1000),
        endsAt: new Date(startDate.getTime() + 4 * 60 * 60 * 1000),
      },
    });
    ids.sessionA = sessionA.id;
    ids.sessionB = sessionB.id;

    // Attendance: A in-person both; B virtual A only; C in-person A only (no-show)
    await prisma.sessionAttendance.createMany({
      data: [
        {
          sessionId: sessionA.id,
          userId: userA.id,
          status: SessionAttendanceStatus.JOINING,
          joinMode: SessionJoinMode.IN_PERSON,
        },
        {
          sessionId: sessionA.id,
          userId: userB.id,
          status: SessionAttendanceStatus.JOINING,
          joinMode: SessionJoinMode.VIRTUAL,
        },
        {
          sessionId: sessionA.id,
          userId: userC.id,
          status: SessionAttendanceStatus.JOINING,
          joinMode: SessionJoinMode.IN_PERSON,
        },
        {
          sessionId: sessionB.id,
          userId: userA.id,
          status: SessionAttendanceStatus.JOINING,
          joinMode: SessionJoinMode.IN_PERSON,
        },
      ],
    });

    // Event-level check-ins for A and B only (C is no-show)
    await prisma.checkIn.createMany({
      data: [
        { eventId: event.id, userId: userA.id, method: CheckInMethod.STAFF_SCAN },
        { eventId: event.id, userId: userB.id, method: CheckInMethod.SELF },
      ],
    });

    await prisma.sessionDiscussionThread.create({
      data: {
        sessionId: sessionA.id,
        authorId: userA.id,
        title: "Q1",
        body: "Question?",
      },
    });

    const poll = await prisma.sessionPoll.create({
      data: {
        sessionId: sessionA.id,
        question: "Useful?",
        createdById: admin.id,
        options: { create: [{ label: "Yes", sortOrder: 0 }, { label: "No", sortOrder: 1 }] },
      },
      include: { options: true },
    });
    await prisma.sessionPollVote.create({
      data: { pollId: poll.id, optionId: poll.options[0]!.id, userId: userA.id },
    });

    await prisma.networkThread.create({
      data: {
        eventId: event.id,
        authorId: userA.id,
        title: "Hello",
        body: "Community post",
      },
    });

    const fb = await prisma.sessionFeedback.create({
      data: {
        sessionId: sessionA.id,
        userId: userA.id,
        rating: 5,
        comment: "Loved it — email me at alpha@example.com please",
      },
    });
    ids.feedbackId = fb.id;
    await prisma.sessionFeedback.create({
      data: {
        sessionId: sessionA.id,
        userId: userB.id,
        rating: 4,
        comment: "Need better wifi next year",
      },
    });

    const template = await prisma.certificateTemplate.create({
      data: {
        eventId: event.id,
        organizationId: org.id,
        name: "Participation",
        titleText: "Certificate of Participation",
        eligibilityRule: CertificateEligibilityRule.ANY_CHECKIN,
      },
    });
    ids.templateId = template.id;

    await prisma.sponsor.create({
      data: {
        eventId: event.id,
        name: "Acme Corp",
        tier: "Gold",
        leads: {
          create: [{ name: "Lead One", email: "lead@example.com", capturedByUserId: admin.id }],
        },
      },
    });
  }, 60_000);

  afterAll(async () => {
    if (!dbReady) {
      await prisma.$disconnect();
      return;
    }
    const eventId = ids.eventId;
    if (eventId) {
      await prisma.eventRecapEmail.deleteMany({ where: { recap: { eventId } } });
      await prisma.eventRecapSection.deleteMany({ where: { recap: { eventId } } });
      await prisma.eventRecap.deleteMany({ where: { eventId } });
      await prisma.issuedCertificate.deleteMany({ where: { eventId } });
      await prisma.certificateTemplate.deleteMany({ where: { eventId } });
      await prisma.sponsorLead.deleteMany({ where: { sponsor: { eventId } } });
      await prisma.sponsor.deleteMany({ where: { eventId } });
      await prisma.sessionPollVote.deleteMany({ where: { poll: { session: { eventId } } } });
      await prisma.sessionPollOption.deleteMany({ where: { poll: { session: { eventId } } } });
      await prisma.sessionPoll.deleteMany({ where: { session: { eventId } } });
      await prisma.sessionFeedback.deleteMany({ where: { session: { eventId } } });
      await prisma.sessionDiscussionUpvote.deleteMany({
        where: { thread: { session: { eventId } } },
      });
      await prisma.sessionDiscussionThread.deleteMany({ where: { session: { eventId } } });
      await prisma.sessionAttendance.deleteMany({ where: { session: { eventId } } });
      await prisma.sessionLike.deleteMany({ where: { session: { eventId } } }).catch(() => undefined);
      await prisma.checkIn.deleteMany({ where: { eventId } });
      await prisma.networkReply.deleteMany({ where: { thread: { eventId } } });
      await prisma.networkThread.deleteMany({ where: { eventId } });
      await prisma.announcementAuditLog.deleteMany({ where: { eventId } });
      await prisma.announcement.deleteMany({ where: { eventId } });
      await prisma.backgroundJob.deleteMany({ where: { eventId } });
      await prisma.aiUsageRecord.deleteMany({ where: { eventId } });
      await prisma.auditLog.deleteMany({ where: { eventId } });
      await prisma.session.deleteMany({ where: { eventId } });
      await prisma.eventMembership.deleteMany({ where: { eventId } });
      await prisma.eventFeatureConfig.deleteMany({ where: { eventId } });
      await prisma.event.delete({ where: { id: eventId } }).catch(() => undefined);
    }
    if (ids.futureEventId) {
      await prisma.eventMembership.deleteMany({ where: { eventId: ids.futureEventId } });
      await prisma.eventFeatureConfig.deleteMany({ where: { eventId: ids.futureEventId } });
      await prisma.event.delete({ where: { id: ids.futureEventId } }).catch(() => undefined);
    }
    if (ids.seriesId) {
      const seriesEvents = await prisma.event.findMany({ where: { seriesId: ids.seriesId } });
      for (const e of seriesEvents) {
        await prisma.eventMembership.deleteMany({ where: { eventId: e.id } });
        await prisma.session.deleteMany({ where: { eventId: e.id } });
        await prisma.event.delete({ where: { id: e.id } }).catch(() => undefined);
      }
      await prisma.eventSeries.delete({ where: { id: ids.seriesId } }).catch(() => undefined);
    }
    for (const oid of [ids.orgId, ids.freeOrgId]) {
      if (!oid) continue;
      await prisma.orgMembership.deleteMany({ where: { organizationId: oid } });
      await prisma.organization.delete({ where: { id: oid } }).catch(() => undefined);
    }
    for (const uid of [ids.adminId, ids.userA, ids.userB, ids.userC, ids.speakerId]) {
      if (uid) await prisma.user.delete({ where: { id: uid } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  function skip() {
    return !dbReady;
  }

  it("1) metrics reconcile exactly with SQL / seeded counts", async () => {
    if (skip()) return;
    const m = await computeRecapMetrics(ids.eventId!);
    // 5 memberships (admin + 3 attendees + speaker)
    expect(m.headline.registrants).toBe(5);
    expect(m.headline.checkIns).toBe(2);
    expect(m.headline.checkInRate).toBe(2 / 5);

    const sessA = m.sessions.find((s) => s.sessionId === ids.sessionA);
    expect(sessA).toBeTruthy();
    expect(sessA!.joinedByMode.IN_PERSON).toBe(2);
    expect(sessA!.joinedByMode.VIRTUAL).toBe(1);
    expect(sessA!.joinedTotal).toBe(3);
    // Event check-in attributed via join mode (A+B checked in; C no-show)
    expect(sessA!.checkedInAttributedByMode.IN_PERSON).toBe(1); // userA
    expect(sessA!.checkedInAttributedByMode.VIRTUAL).toBe(1); // userB
    expect(sessA!.checkedInAttributedTotal).toBe(2);
    expect(sessA!.noShowTotal).toBe(1);
    expect(m.labels.checkedInAttributedByMode).toMatch(/not a per-session door scan/i);

    expect(m.engagement.qaThreads).toBe(1);
    expect(m.engagement.pollVotes).toBe(1);
    expect(m.engagement.communityThreads).toBe(1);
    expect(m.engagement.engagementPoints).toBe(50); // 40+10+0 (+admin/speaker 0)
    expect(m.topSessions[0]!.sessionId).toBe(ids.sessionA);
  });

  it("2) narrative numbers deep-equal metrics; invented number rejected", async () => {
    if (skip()) return;
    const snapshot = await computeRecapMetrics(ids.eventId!);
    const ok = finalizeReportNarrative(
      "Regs {{headline.registrants}} check-ins {{headline.checkIns}} rate {{headline.checkInRate}}",
      snapshot,
    );
    expect(ok).toContain(String(snapshot.headline.registrants));
    expect(ok).toContain(String(snapshot.headline.checkIns));
    expect(ok).toContain(String(snapshot.headline.checkInRate));

    expect(() => finalizeReportNarrative("We had 999 guests", snapshot)).toThrow(RecapSectionError);
    expect(() =>
      finalizeReportNarrative("Bad {{headline.notARealPath}}", snapshot),
    ).toThrow(RecapSectionError);
  });

  it("3) every synthesis quote maps to a real stored comment; invented rejected", async () => {
    if (skip()) return;
    const bank = await buildFeedbackQuoteBank(ids.eventId!);
    expect(bank.length).toBeGreaterThanOrEqual(2);
    const qid = quoteIdForFeedback(ids.feedbackId!);
    expect(bank.some((q) => q.quoteId === qid)).toBe(true);
    expect(bank.find((q) => q.quoteId === qid)!.text).not.toMatch(/@/);
    expect(bank.find((q) => q.quoteId === qid)!.text).toMatch(/\[email\]/);

    const fbRows = await prisma.sessionFeedback.findMany({
      where: { session: { eventId: ids.eventId! }, comment: { not: null } },
    });
    for (const q of bank) {
      const row = fbRows.find((f) => f.id === q.feedbackId);
      expect(row).toBeTruthy();
      expect(row!.comment).toBeTruthy();
    }

    const themes = resolveSynthesisThemes(
      [{ label: "Theme", quoteIds: [qid, "sf_invented_quote"] }],
      bank,
    );
    expect(themes[0]!.quoteIds).toEqual([qid]);
    expect(themes[0]!.commentCount).toBe(1);
    expect(themes[0]!.quotes[0]!.text).toBe(bank.find((q) => q.quoteId === qid)!.text);
  });

  it("4–7) generate drafts only; regen replaces drafts; SENT stable; certs stable", async () => {
    if (skip()) return;

    const provider = emailMod.getEmailProvider();
    emailSendSpy = vi.spyOn(provider, "send");

    const first = await generateEventRecap({
      eventId: ids.eventId!,
      organizationId: ids.orgId!,
      createdById: ids.adminId!,
    });
    expect(first.status).toBe("READY");

    // Drain certificate batch jobs (sendReadyEmail:false)
    for (let i = 0; i < 20; i++) {
      const n = await processDueJobs(5);
      if (n === 0) break;
    }

    expect(emailSendSpy).not.toHaveBeenCalled();
    const emailAttemptsAfterGen = await prisma.announcementAuditLog.count({
      where: { eventId: ids.eventId!, action: "EMAIL_ATTEMPT" },
    });
    expect(emailAttemptsAfterGen).toBe(0);
    const published = await prisma.announcement.count({
      where: { eventId: ids.eventId!, isPreview: false },
    });
    expect(published).toBe(0);

    const recap = await prisma.eventRecap.findUniqueOrThrow({
      where: { id: first.recapId },
      include: {
        sections: true,
        emails: true,
      },
    });
    const liveSections = recap.sections.filter((s) => s.status === RecapSectionStatus.DRAFT);
    expect(liveSections.some((s) => s.kind === "REPORT")).toBe(true);
    expect(liveSections.some((s) => s.kind === "FEEDBACK_SYNTHESIS")).toBe(true);
    expect(liveSections.some((s) => s.kind === "CERTIFICATES")).toBe(true);
    expect(liveSections.some((s) => s.kind === "SPONSOR_ONE_PAGER")).toBe(true);
    expect(liveSections.every((s) => s.aiGenerated)).toBe(true);

    const report = liveSections.find((s) => s.kind === "REPORT")!;
    const snapshot = recap.metricsSnapshot as {
      headline: { registrants: number; checkIns: number; checkInRate: number };
    };
    expect(report.bodyMarkdown).toContain(String(snapshot.headline.registrants));
    expect(report.bodyMarkdown).toContain(String(snapshot.headline.checkIns));

    const certs = await prisma.issuedCertificate.findMany({
      where: { eventId: ids.eventId! },
    });
    expect(certs.length).toBeGreaterThanOrEqual(1);
    const certSnapshot = certs.map((c) => ({
      id: c.id,
      publicId: c.publicId,
      issuedAt: c.issuedAt.toISOString(),
    }));

    // Mark one thank-you as SENT via explicit send path
    const thankYou = recap.emails.find((e) => e.kind === "THANK_YOU_ATTENDEE")!;
    // Soft: call send but spy already on provider — will attempt send
    await sendRecapEmail({
      recapEmailId: thankYou.id,
      eventId: ids.eventId!,
      actorId: ids.adminId!,
    });
    const sentRow = await prisma.eventRecapEmail.findUniqueOrThrow({ where: { id: thankYou.id } });
    expect(sentRow.status).toBe(RecapEmailStatus.SENT);
    expect(sentRow.sentAt).toBeTruthy();
    const sentAt = sentRow.sentAt!.toISOString();
    const attemptsAfterSend = await prisma.announcementAuditLog.count({
      where: { eventId: ids.eventId!, action: "EMAIL_ATTEMPT" },
    });
    expect(attemptsAfterSend).toBe(1);

    // Reset spy call count for regen assertions (regen must not add sends)
    emailSendSpy.mockClear();

    const second = await generateEventRecap({
      eventId: ids.eventId!,
      organizationId: ids.orgId!,
      createdById: ids.adminId!,
    });
    expect(second.regenerated).toBe(true);

    for (let i = 0; i < 20; i++) {
      const n = await processDueJobs(5);
      if (n === 0) break;
    }

    expect(emailSendSpy).not.toHaveBeenCalled();

    const after = await prisma.eventRecap.findUniqueOrThrow({
      where: { id: first.recapId },
      include: { sections: true, emails: true },
    });

    const draftSections = after.sections.filter((s) => s.status === RecapSectionStatus.DRAFT);
    const superseded = after.sections.filter((s) => s.status === RecapSectionStatus.SUPERSEDED);
    expect(superseded.length).toBeGreaterThan(0);
    // One live set per kind (sponsor one-pagers keyed by sponsorId)
    const reportLive = draftSections.filter((s) => s.kind === "REPORT");
    expect(reportLive).toHaveLength(1);
    expect(draftSections.filter((s) => s.kind === "FEEDBACK_SYNTHESIS")).toHaveLength(1);

    const sentStill = after.emails.find((e) => e.id === thankYou.id)!;
    expect(sentStill.status).toBe(RecapEmailStatus.SENT);
    expect(sentStill.sentAt!.toISOString()).toBe(sentAt);
    const attemptsAfterRegen = await prisma.announcementAuditLog.count({
      where: { eventId: ids.eventId!, action: "EMAIL_ATTEMPT" },
    });
    expect(attemptsAfterRegen).toBe(1); // no second EMAIL_ATTEMPT

    // No new DRAFT thank-you for SENT kind (partial unique)
    const thankYouDrafts = after.emails.filter(
      (e) => e.kind === "THANK_YOU_ATTENDEE" && e.status === RecapEmailStatus.DRAFT,
    );
    expect(thankYouDrafts).toHaveLength(0);

    const certsAfter = await prisma.issuedCertificate.findMany({
      where: { eventId: ids.eventId! },
    });
    for (const before of certSnapshot) {
      const match = certsAfter.find((c) => c.id === before.id);
      expect(match).toBeTruthy();
      expect(match!.publicId).toBe(before.publicId);
      expect(match!.issuedAt.toISOString()).toBe(before.issuedAt);
    }
  });

  it("8) PRO gating — FREE cannot use recap_agent", async () => {
    if (skip()) return;
    expect(await can(ids.orgId!, "recap_agent")).toBe(true);
    expect(await can(ids.freeOrgId!, "recap_agent")).toBe(false);
  });

  it("9) after endDate only", async () => {
    if (skip()) return;
    const future = await prisma.event.findUniqueOrThrow({ where: { id: ids.futureEventId! } });
    expect(Date.now() < future.endDate.getTime()).toBe(true);
    await expect(
      generateEventRecap({
        eventId: ids.futureEventId!,
        organizationId: ids.orgId!,
        createdById: ids.adminId!,
      }),
    ).rejects.toMatchObject({ code: "EVENT_NOT_ENDED" });

    const ended = await prisma.event.findUniqueOrThrow({ where: { id: ids.eventId! } });
    expect(Date.now() >= ended.endDate.getTime()).toBe(true);
  });

  it("10) series checklist lineage idempotent + clone carries items", async () => {
    if (skip()) return;
    const recap = await prisma.eventRecap.findUniqueOrThrow({ where: { eventId: ids.eventId! } });
    const fix = recap.fixNextYear as { key: string; label: string }[];
    expect(Array.isArray(fix)).toBe(true);
    expect(fix.length).toBeGreaterThan(0);

    const series = await prisma.eventSeries.findUniqueOrThrow({ where: { id: ids.seriesId! } });
    const checklist = series.setupChecklist as { key: string; label: string; done?: boolean }[];
    for (const item of fix) {
      expect(checklist.some((c) => c.key === item.key)).toBe(true);
    }

    // Idempotent merge
    const merged = mergeFixNextYearIntoChecklist(checklist, fix, {
      sourceEventId: ids.eventId!,
      sourceRecapId: recap.id,
    });
    expect(merged.filter((c) => c.key === fix[0]!.key)).toHaveLength(1);

    const cloned = await cloneNextEdition(prisma, {
      sourceEventId: ids.eventId!,
      organizationId: ids.orgId!,
      createdById: ids.adminId!,
      startDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    });
    expect(cloned.seriesId).toBe(ids.seriesId);
    const afterClone = await prisma.eventSeries.findUniqueOrThrow({ where: { id: ids.seriesId! } });
    const carried = afterClone.setupChecklist as { key: string; done: boolean }[];
    for (const item of fix) {
      const row = carried.find((c) => c.key === item.key);
      expect(row).toBeTruthy();
      expect(row!.done).toBe(false);
    }
  });
});
