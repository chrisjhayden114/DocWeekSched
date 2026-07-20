import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CfpFormStatus,
  CfpSubmissionStatus,
  EventMemberRole,
  OrgRole,
  PrismaClient,
  SessionPublishStatus,
} from "@prisma/client";
import { hashPassword } from "../lib/auth";
import { HttpError } from "../lib/authorization";
import { requireCfpManage, requireCfpReviewer, requireEventAccess } from "../lib/authorization";
import {
  assignReviews,
  convertSubmission,
  ensureReviewerMembership,
  hashToken,
  newCfpToken,
  redactSubmitter,
  weightedAverage,
  parseRubric,
  assertCfpWindowOpen,
} from "../lib/cfp";
import { upsertFeatureOverrides } from "../lib/features";
import { applyPlanSkuToOrg } from "../lib/billing/entitlements";

describe("CFP tenancy & conversion (DB)", () => {
  const prisma = new PrismaClient();
  const ids: {
    orgA?: string;
    orgB?: string;
    eventA?: string;
    eventB?: string;
    adminA?: string;
    reviewer?: string;
    formA?: string;
    formB?: string;
    subA?: string;
    sessionId?: string;
  } = {};
  let dbReady = false;

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await prisma.cfpForm.findFirst();
    } catch {
      console.warn("[cfp.db.test] DB unreachable or CFP tables missing — skipping");
      return;
    }
    dbReady = true;
    const stamp = Date.now();
    const passwordHash = await hashPassword("TestPass12!x");

    const admin = await prisma.user.create({
      data: { email: `cfp-admin-${stamp}@example.com`, name: "CFP Admin", passwordHash, role: "ADMIN" },
    });
    const reviewer = await prisma.user.create({
      data: { email: `cfp-rev-${stamp}@example.com`, name: "CFP Reviewer", passwordHash, role: "ATTENDEE" },
    });
    ids.adminA = admin.id;
    ids.reviewer = reviewer.id;

    const orgA = await prisma.organization.create({
      data: {
        name: `CFP Org A ${stamp}`,
        slug: `cfp-a-${stamp}`,
        plan: "PRO",
        eventAllowance: 10,
        memberships: { create: { userId: admin.id, role: OrgRole.OWNER } },
      },
    });
    const orgB = await prisma.organization.create({
      data: {
        name: `CFP Org B ${stamp}`,
        slug: `cfp-b-${stamp}`,
        plan: "PRO",
        eventAllowance: 10,
        memberships: { create: { userId: admin.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgA = orgA.id;
    ids.orgB = orgB.id;
    await applyPlanSkuToOrg(orgA.id, "pro_annual");
    await applyPlanSkuToOrg(orgB.id, "pro_annual");

    const eventA = await prisma.event.create({
      data: {
        name: `CFP Event A ${stamp}`,
        slug: `cfp-evt-a-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2027-05-01T12:00:00Z"),
        endDate: new Date("2027-05-03T12:00:00Z"),
        organizationId: orgA.id,
        createdById: admin.id,
        memberships: { create: { userId: admin.id, role: EventMemberRole.ADMIN } },
      },
    });
    const eventB = await prisma.event.create({
      data: {
        name: `CFP Event B ${stamp}`,
        slug: `cfp-evt-b-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2027-06-01T12:00:00Z"),
        endDate: new Date("2027-06-03T12:00:00Z"),
        organizationId: orgB.id,
        createdById: admin.id,
        memberships: { create: { userId: admin.id, role: EventMemberRole.ADMIN } },
      },
    });
    ids.eventA = eventA.id;
    ids.eventB = eventB.id;

    await upsertFeatureOverrides(eventA.id, { cfp: true });
    await upsertFeatureOverrides(eventB.id, { cfp: true });

    const rubric = [
      { id: "novelty", criterion: "Novelty", weight: 1 },
      { id: "clarity", criterion: "Clarity", weight: 1 },
    ];

    const formA = await prisma.cfpForm.create({
      data: {
        eventId: eventA.id,
        title: "CFP A",
        opensAt: new Date("2020-01-01T00:00:00Z"),
        closesAt: new Date("2099-01-01T00:00:00Z"),
        status: CfpFormStatus.OPEN,
        blindReview: true,
        rubric,
      },
    });
    const formB = await prisma.cfpForm.create({
      data: {
        eventId: eventB.id,
        title: "CFP B",
        opensAt: new Date("2020-01-01T00:00:00Z"),
        closesAt: new Date("2099-01-01T00:00:00Z"),
        status: CfpFormStatus.OPEN,
        blindReview: true,
        rubric,
      },
    });
    ids.formA = formA.id;
    ids.formB = formB.id;

    await ensureReviewerMembership(prisma, eventA.id, reviewer.id);
    await prisma.cfpReviewer.create({ data: { cfpFormId: formA.id, userId: reviewer.id } });

    const access = newCfpToken();
    const sub = await prisma.cfpSubmission.create({
      data: {
        cfpFormId: formA.id,
        submitterName: "Ada Lovelace",
        submitterEmail: `ada-${stamp}@example.com`,
        title: "Notes on the Analytical Engine",
        abstract: "A foundational paper.",
        status: CfpSubmissionStatus.SUBMITTED,
        emailVerifiedAt: new Date(),
        submittedAt: new Date(),
        accessTokenHash: access.hash,
      },
    });
    ids.subA = sub.id;

    const hostSession = await prisma.session.create({
      data: {
        eventId: eventA.id,
        title: "Paper session",
        startsAt: new Date("2027-05-01T15:00:00Z"),
        endsAt: new Date("2027-05-01T17:00:00Z"),
        publishStatus: SessionPublishStatus.DRAFT,
      },
    });
    ids.sessionId = hostSession.id;
  });

  afterAll(async () => {
    if (!dbReady) {
      await prisma.$disconnect().catch(() => undefined);
      return;
    }
    for (const eventId of [ids.eventA, ids.eventB].filter(Boolean) as string[]) {
      await prisma.cfpDecisionEmail.deleteMany({ where: { submission: { cfpForm: { eventId } } } });
      await prisma.cfpReview.deleteMany({ where: { submission: { cfpForm: { eventId } } } });
      await prisma.cfpAttachment.deleteMany({ where: { submission: { cfpForm: { eventId } } } });
      await prisma.cfpSubmission.deleteMany({ where: { cfpForm: { eventId } } });
      await prisma.cfpReviewer.deleteMany({ where: { cfpForm: { eventId } } });
      await prisma.cfpForm.deleteMany({ where: { eventId } });
      await prisma.sessionItemAuthor.deleteMany({ where: { sessionItem: { session: { eventId } } } });
      await prisma.sessionItem.deleteMany({ where: { session: { eventId } } });
      await prisma.sessionSpeaker.deleteMany({ where: { session: { eventId } } });
      await prisma.session.deleteMany({ where: { eventId } });
      await prisma.speaker.deleteMany({ where: { eventId } });
      await prisma.eventFeatureConfig.deleteMany({ where: { eventId } });
      await prisma.eventMembership.deleteMany({ where: { eventId } });
      await prisma.event.deleteMany({ where: { id: eventId } });
    }
    for (const orgId of [ids.orgA, ids.orgB].filter(Boolean) as string[]) {
      await prisma.orgMembership.deleteMany({ where: { organizationId: orgId } });
      await prisma.organization.deleteMany({ where: { id: orgId } });
    }
    for (const userId of [ids.adminA, ids.reviewer].filter(Boolean) as string[]) {
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await prisma.$disconnect();
  });

  it("REVIEWER cannot canManageEvent / admin surfaces", async () => {
    if (!dbReady) return;
    const access = await requireEventAccess(ids.reviewer!, ids.eventA!, { requireMembership: true });
    expect(access.isEventReviewer).toBe(true);
    expect(access.canManageEvent).toBe(false);
    await expect(requireCfpManage(ids.reviewer!, ids.eventA!)).rejects.toMatchObject({ status: 403 });
    await expect(requireEventAccess(ids.reviewer!, ids.eventA!, { manage: true })).rejects.toMatchObject({
      status: 403,
    });
  });

  it("reviewer sees only assigned submissions; blind hides identity", async () => {
    if (!dbReady) return;
    await assignReviews(prisma, ids.formA!, "all");
    const { form, isManager } = await requireCfpReviewer(ids.reviewer!, ids.formA!);
    expect(isManager).toBe(false);
    expect(form.blindReview).toBe(true);

    const mine = await prisma.cfpReview.findMany({
      where: { reviewerUserId: ids.reviewer!, submission: { cfpFormId: ids.formA! } },
      include: { submission: true },
    });
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.submission.cfpFormId === ids.formA)).toBe(true);

    const otherFormReviews = await prisma.cfpReview.findMany({
      where: { reviewerUserId: ids.reviewer!, submission: { cfpFormId: ids.formB! } },
    });
    expect(otherFormReviews).toHaveLength(0);

    const redacted = redactSubmitter(
      { submitterName: mine[0].submission.submitterName, submitterEmail: mine[0].submission.submitterEmail },
      true,
    );
    expect(redacted.submitterName).toBe("[hidden]");
  });

  it("cross-org manage is 403 for non-member org event", async () => {
    if (!dbReady) return;
    // reviewer is not on org B / event B
    await expect(requireCfpManage(ids.reviewer!, ids.eventB!)).rejects.toMatchObject({ status: 403 });
    await expect(requireCfpReviewer(ids.reviewer!, ids.formB!)).rejects.toMatchObject({ status: 403 });
  });

  it("submitter tokenized access is hash-based; close-date enforced", async () => {
    if (!dbReady) return;
    const raw = "test-access-token-raw-value-32bytes!!";
    const hash = hashToken(raw);
    await prisma.cfpSubmission.update({
      where: { id: ids.subA! },
      data: { accessTokenHash: hash },
    });
    const found = await prisma.cfpSubmission.findFirst({ where: { accessTokenHash: hash } });
    expect(found?.id).toBe(ids.subA);
    expect(found?.accessTokenHash).not.toBe(raw);

    const closed = await prisma.cfpForm.create({
      data: {
        eventId: ids.eventA!,
        title: "Closed",
        opensAt: new Date("2020-01-01"),
        closesAt: new Date("2020-01-02"),
        status: CfpFormStatus.OPEN,
        rubric: [],
      },
    });
    expect(() => assertCfpWindowOpen(closed, new Date("2021-01-01"))).toThrow(HttpError);
    await prisma.cfpForm.delete({ where: { id: closed.id } });
  });

  it("conversion places SessionItem with author order (submitter first)", async () => {
    if (!dbReady) return;
    await prisma.cfpSubmission.update({
      where: { id: ids.subA! },
      data: { status: CfpSubmissionStatus.ACCEPTED },
    });

    const result = await convertSubmission({
      prisma,
      submissionId: ids.subA!,
      mode: "session_item",
      targetSessionId: ids.sessionId!,
      additionalAuthors: ["Charles Babbage", "Second Author"],
    });

    expect(result.sessionItemId).toBeTruthy();
    expect(result.authorOrder).toEqual(["Ada Lovelace", "Charles Babbage", "Second Author"]);

    const authors = await prisma.sessionItemAuthor.findMany({
      where: { sessionItemId: result.sessionItemId! },
      orderBy: { sortOrder: "asc" },
    });
    expect(authors.map((a) => a.name)).toEqual(["Ada Lovelace", "Charles Babbage", "Second Author"]);
    expect(authors[0].isPresenter).toBe(true);
    expect(authors[0].sortOrder).toBe(0);

    const item = await prisma.sessionItem.findUnique({ where: { id: result.sessionItemId! } });
    expect(item?.sessionId).toBe(ids.sessionId);

    // standalone convert for a second accepted sub
    const sub2 = await prisma.cfpSubmission.create({
      data: {
        cfpFormId: ids.formA!,
        submitterName: "Grace Hopper",
        submitterEmail: `grace-${Date.now()}@example.com`,
        title: "COBOL notes",
        abstract: "…",
        status: CfpSubmissionStatus.ACCEPTED,
        emailVerifiedAt: new Date(),
        submittedAt: new Date(),
      },
    });
    const standalone = await convertSubmission({
      prisma,
      submissionId: sub2.id,
      mode: "standalone_session",
    });
    expect(standalone.sessionId).toBeTruthy();
    const sess = await prisma.session.findUnique({ where: { id: standalone.sessionId! } });
    expect(sess?.publishStatus).toBe(SessionPublishStatus.DRAFT);
  });

  it("weighted rollup sorts decisions", async () => {
    if (!dbReady) return;
    const rubric = parseRubric([
      { id: "novelty", criterion: "Novelty", weight: 1 },
      { id: "clarity", criterion: "Clarity", weight: 1 },
    ]);
    const a = weightedAverage(rubric, [{ scores: { novelty: 5, clarity: 5 }, recusedAt: null }]);
    const b = weightedAverage(rubric, [{ scores: { novelty: 2, clarity: 2 }, recusedAt: null }]);
    expect((a ?? 0) > (b ?? 0)).toBe(true);
  });
});
