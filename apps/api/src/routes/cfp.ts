/**
 * Phase P3 — Call for Papers / abstracts.
 */

import { Router } from "express";
import {
  CfpDecisionEmailKind,
  CfpFormStatus,
  CfpSubmissionStatus,
  type Prisma,
} from "@prisma/client";
import { z } from "zod";
import {
  asyncHandler,
  HttpError,
  requireCfpManage,
  requireCfpReviewer,
  requireEventAccess,
} from "../lib/authorization";
import {
  applyMergeFields,
  assertCfpWindowOpen,
  assertScoreMap,
  assignReviews,
  convertSubmission,
  DEFAULT_ACCEPT_BODY,
  DEFAULT_ACCEPT_SUBJECT,
  DEFAULT_REJECT_BODY,
  DEFAULT_REJECT_SUBJECT,
  ensureReviewerMembership,
  newCfpToken,
  hashToken,
  parseRubric,
  redactSubmitter,
  weightedAverage,
} from "../lib/cfp";
import { prisma } from "../lib/db";
import { env } from "../lib/env";
import { featureEnabled, requireFeature } from "../lib/features";
import { getEmailProvider } from "../lib/email";
import type { AuthedRequest } from "../lib/middleware";
import { requireAuth, requireCsrf } from "../lib/middleware";
import { getStorageProvider } from "../lib/storage";

export const cfpRouter = Router();

const CFP_MAX_ATTACHMENT_BYTES = 10_000_000;
const CFP_ALLOWED_MIME = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "image/png",
  "image/jpeg",
];

const rubricSchema = z.array(
  z.object({
    id: z.string().min(1),
    criterion: z.string().min(1),
    weight: z.number().positive(),
  }),
);

const customFieldSchema = z.array(
  z.object({
    id: z.string().min(1),
    type: z.enum(["text", "textarea", "select", "file"]),
    label: z.string().min(1),
    required: z.boolean().optional(),
    options: z.array(z.string()).optional(),
  }),
);

function webBase() {
  return env.webBaseUrl.replace(/\/$/, "");
}

async function loadFormForEvent(eventId: string, formId?: string) {
  if (formId) {
    const form = await prisma.cfpForm.findFirst({ where: { id: formId, eventId } });
    if (!form) throw new HttpError(404, { error: "CFP not found" });
    return form;
  }
  const form = await prisma.cfpForm.findFirst({
    where: { eventId },
    orderBy: { createdAt: "desc" },
  });
  if (!form) throw new HttpError(404, { error: "CFP not found" });
  return form;
}

function submissionPublicUrl(slug: string, accessToken: string) {
  return `${webBase()}/e/${slug}/cfp/submission?token=${encodeURIComponent(accessToken)}`;
}

function verifyUrl(slug: string, verifyToken: string) {
  return `${webBase()}/e/${slug}/cfp/verify?token=${encodeURIComponent(verifyToken)}`;
}

// ---------------------------------------------------------------------------
// Public (no auth)
// ---------------------------------------------------------------------------

cfpRouter.get(
  "/public/:slug",
  asyncHandler(async (req, res) => {
    const slug = String(req.params.slug || "").toLowerCase();
    const event = await prisma.event.findUnique({ where: { slug } });
    if (!event) throw new HttpError(404, { error: "Event not found" });
    const enabled = await featureEnabled(event.id, "cfp");
    if (!enabled) throw new HttpError(404, { error: "CFP not available for this event" });

    const form = await prisma.cfpForm.findFirst({
      where: { eventId: event.id, status: { in: [CfpFormStatus.OPEN, CfpFormStatus.CLOSED] } },
      orderBy: { createdAt: "desc" },
    });
    if (!form) throw new HttpError(404, { error: "CFP not found" });

    const now = new Date();
    const open =
      form.status === CfpFormStatus.OPEN && now >= form.opensAt && now <= form.closesAt;

    return res.json({
      event: { id: event.id, name: event.name, slug: event.slug, timezone: event.timezone },
      form: {
        id: form.id,
        title: form.title,
        description: form.description,
        opensAt: form.opensAt,
        closesAt: form.closesAt,
        status: form.status,
        customFields: form.customFields,
        maxSubmissionsPerPerson: form.maxSubmissionsPerPerson,
        blindReview: form.blindReview,
        accepting: open,
      },
    });
  }),
);

const publicSubmitSchema = z.object({
  submitterName: z.string().min(1).max(200),
  submitterEmail: z.string().email().max(320),
  title: z.string().min(1).max(500),
  abstract: z.string().min(1).max(50_000),
  answers: z.record(z.unknown()).optional(),
  attachments: z
    .array(
      z.object({
        fileName: z.string().min(1).max(260),
        mime: z.string().min(1).max(120),
        url: z.string().min(1),
      }),
    )
    .max(5)
    .optional(),
});

cfpRouter.post(
  "/public/:slug/submit",
  asyncHandler(async (req, res) => {
    const slug = String(req.params.slug || "").toLowerCase();
    const parsed = publicSubmitSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const event = await prisma.event.findUnique({ where: { slug } });
    if (!event) throw new HttpError(404, { error: "Event not found" });
    await requireFeature(event.id, "cfp");

    const form = await prisma.cfpForm.findFirst({
      where: { eventId: event.id, status: CfpFormStatus.OPEN },
      orderBy: { createdAt: "desc" },
    });
    if (!form) throw new HttpError(404, { error: "CFP not found" });
    assertCfpWindowOpen(form);

    const email = parsed.data.submitterEmail.trim().toLowerCase();
    const prior = await prisma.cfpSubmission.count({
      where: {
        cfpFormId: form.id,
        submitterEmail: email,
        status: { not: CfpSubmissionStatus.WITHDRAWN },
        OR: [{ emailVerifiedAt: { not: null } }, { status: { not: CfpSubmissionStatus.DRAFT } }],
      },
    });
    // Count verified / non-draft toward cap
    const verifiedCount = await prisma.cfpSubmission.count({
      where: {
        cfpFormId: form.id,
        submitterEmail: email,
        emailVerifiedAt: { not: null },
        status: { not: CfpSubmissionStatus.WITHDRAWN },
      },
    });
    if (verifiedCount >= form.maxSubmissionsPerPerson) {
      throw new HttpError(403, {
        error: `This CFP allows ${form.maxSubmissionsPerPerson} submission(s) per email`,
      });
    }
    void prior;

    const verify = newCfpToken();
    const access = newCfpToken();

    const submission = await prisma.cfpSubmission.create({
      data: {
        cfpFormId: form.id,
        submitterName: parsed.data.submitterName.trim(),
        submitterEmail: email,
        title: parsed.data.title.trim(),
        abstract: parsed.data.abstract.trim(),
        answers: (parsed.data.answers || {}) as Prisma.InputJsonValue,
        status: CfpSubmissionStatus.DRAFT,
        verifyTokenHash: verify.hash,
        accessTokenHash: access.hash,
      },
    });

    for (const att of parsed.data.attachments || []) {
      const stored = await getStorageProvider().acceptUpload({
        url: att.url,
        keyPrefix: `events/${event.id}/cfp/${submission.id}`,
        maxBytes: CFP_MAX_ATTACHMENT_BYTES,
        allowedMimeTypes: CFP_ALLOWED_MIME,
      });
      let sizeBytes = 0;
      if (att.url.startsWith("data:")) {
        const b64 = att.url.split(",")[1] || "";
        sizeBytes = Buffer.from(b64, "base64").length;
      } else {
        sizeBytes = Math.min(CFP_MAX_ATTACHMENT_BYTES, att.url.length);
      }
      await prisma.cfpAttachment.create({
        data: {
          submissionId: submission.id,
          fileName: att.fileName,
          mime: att.mime,
          sizeBytes,
          url: stored.url,
          storageKey: stored.storageKey,
        },
      });
    }

    const vUrl = verifyUrl(slug, verify.raw);
    await getEmailProvider().send({
      to: email,
      from: process.env.RESEND_FROM_EMAIL || `CFP <noreply@${new URL(webBase()).hostname}>`,
      subject: `Confirm your submission: ${submission.title}`,
      logLabel: "cfp-verify",
      copyUrl: vUrl,
      html: `<p>Hi ${submission.submitterName},</p>
<p>Please confirm your abstract “${submission.title}” for <strong>${event.name}</strong>.</p>
<p><a href="${vUrl.replace(/"/g, "&quot;")}">Confirm submission</a></p>
<p>If you did not submit this, ignore this email.</p>`,
    });

    return res.status(201).json({
      ok: true,
      submissionId: submission.id,
      message: "Check your email to confirm the submission",
      // access token returned only after verify; draft link for client draft continuity
      draftAccessToken: access.raw,
    });
  }),
);

cfpRouter.post(
  "/public/verify",
  asyncHandler(async (req, res) => {
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    if (!token) throw new HttpError(400, { error: "token required" });
    const hash = hashToken(token);
    const sub = await prisma.cfpSubmission.findFirst({
      where: { verifyTokenHash: hash },
      include: { cfpForm: { include: { event: true } } },
    });
    if (!sub) throw new HttpError(404, { error: "Invalid or expired verification link" });

    assertCfpWindowOpen(sub.cfpForm);

    const access = newCfpToken();
    const updated = await prisma.cfpSubmission.update({
      where: { id: sub.id },
      data: {
        emailVerifiedAt: new Date(),
        submittedAt: new Date(),
        status: CfpSubmissionStatus.SUBMITTED,
        verifyTokenHash: null,
        accessTokenHash: access.hash,
      },
    });

    return res.json({
      ok: true,
      submissionId: updated.id,
      accessToken: access.raw,
      accessUrl: submissionPublicUrl(sub.cfpForm.event.slug, access.raw),
      title: updated.title,
    });
  }),
);

cfpRouter.get(
  "/public/submission",
  asyncHandler(async (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token.trim() : "";
    if (!token) throw new HttpError(400, { error: "token required" });
    const sub = await prisma.cfpSubmission.findFirst({
      where: { accessTokenHash: hashToken(token) },
      include: {
        attachments: true,
        cfpForm: { select: { title: true, blindReview: true, event: { select: { name: true, slug: true } } } },
      },
    });
    if (!sub) throw new HttpError(404, { error: "Submission not found" });
    return res.json({
      id: sub.id,
      title: sub.title,
      abstract: sub.abstract,
      status: sub.status,
      submitterName: sub.submitterName,
      submitterEmail: sub.submitterEmail,
      submittedAt: sub.submittedAt,
      attachments: sub.attachments.map((a) => ({
        id: a.id,
        fileName: a.fileName,
        mime: a.mime,
        url: a.url,
      })),
      formTitle: sub.cfpForm.title,
      eventName: sub.cfpForm.event.name,
      eventSlug: sub.cfpForm.event.slug,
    });
  }),
);

// ---------------------------------------------------------------------------
// Organizer manage
// ---------------------------------------------------------------------------

const formUpsertSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(20_000).optional().nullable(),
  opensAt: z.string().datetime(),
  closesAt: z.string().datetime(),
  status: z.nativeEnum(CfpFormStatus).optional(),
  customFields: customFieldSchema.optional(),
  maxSubmissionsPerPerson: z.number().int().min(1).max(20).optional(),
  blindReview: z.boolean().optional(),
  rubric: rubricSchema.optional(),
  acceptEmailSubject: z.string().max(500).optional().nullable(),
  acceptEmailBody: z.string().max(20_000).optional().nullable(),
  rejectEmailSubject: z.string().max(500).optional().nullable(),
  rejectEmailBody: z.string().max(20_000).optional().nullable(),
});

cfpRouter.get(
  "/manage",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const eventId = String(req.headers["x-event-id"] || "");
    if (!eventId) throw new HttpError(400, { error: "x-event-id required" });
    await requireCfpManage(req.user!.id, eventId);
    const forms = await prisma.cfpForm.findMany({
      where: { eventId },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { submissions: true, reviewers: true } },
      },
    });
    return res.json({ forms });
  }),
);

cfpRouter.post(
  "/manage",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const eventId = String(req.headers["x-event-id"] || "");
    if (!eventId) throw new HttpError(400, { error: "x-event-id required" });
    await requireCfpManage(req.user!.id, eventId);
    const parsed = formUpsertSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const opensAt = new Date(parsed.data.opensAt);
    const closesAt = new Date(parsed.data.closesAt);
    if (closesAt <= opensAt) throw new HttpError(400, { error: "closesAt must be after opensAt" });

    // Enable feature when creating a form
    const { upsertFeatureOverrides, loadFeatureOverrides } = await import("../lib/features");
    const overrides = await loadFeatureOverrides(eventId);
    if (overrides.cfp !== true) {
      await upsertFeatureOverrides(eventId, { ...overrides, cfp: true });
    }

    const form = await prisma.cfpForm.create({
      data: {
        eventId,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        opensAt,
        closesAt,
        status: parsed.data.status ?? CfpFormStatus.DRAFT,
        customFields: (parsed.data.customFields || []) as unknown as Prisma.InputJsonValue,
        maxSubmissionsPerPerson: parsed.data.maxSubmissionsPerPerson ?? 1,
        blindReview: parsed.data.blindReview ?? true,
        rubric: (parsed.data.rubric || []) as unknown as Prisma.InputJsonValue,
        acceptEmailSubject: parsed.data.acceptEmailSubject ?? DEFAULT_ACCEPT_SUBJECT,
        acceptEmailBody: parsed.data.acceptEmailBody ?? DEFAULT_ACCEPT_BODY,
        rejectEmailSubject: parsed.data.rejectEmailSubject ?? DEFAULT_REJECT_SUBJECT,
        rejectEmailBody: parsed.data.rejectEmailBody ?? DEFAULT_REJECT_BODY,
      },
    });
    return res.status(201).json(form);
  }),
);

cfpRouter.put(
  "/manage/:formId",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const eventId = String(req.headers["x-event-id"] || "");
    await requireCfpManage(req.user!.id, eventId);
    const form = await loadFormForEvent(eventId, req.params.formId);
    const parsed = formUpsertSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const updated = await prisma.cfpForm.update({
      where: { id: form.id },
      data: {
        title: parsed.data.title,
        description: parsed.data.description === undefined ? undefined : parsed.data.description,
        opensAt: parsed.data.opensAt ? new Date(parsed.data.opensAt) : undefined,
        closesAt: parsed.data.closesAt ? new Date(parsed.data.closesAt) : undefined,
        status: parsed.data.status,
        customFields: parsed.data.customFields as unknown as Prisma.InputJsonValue | undefined,
        maxSubmissionsPerPerson: parsed.data.maxSubmissionsPerPerson,
        blindReview: parsed.data.blindReview,
        rubric: parsed.data.rubric as unknown as Prisma.InputJsonValue | undefined,
        acceptEmailSubject: parsed.data.acceptEmailSubject === undefined ? undefined : parsed.data.acceptEmailSubject,
        acceptEmailBody: parsed.data.acceptEmailBody === undefined ? undefined : parsed.data.acceptEmailBody,
        rejectEmailSubject: parsed.data.rejectEmailSubject === undefined ? undefined : parsed.data.rejectEmailSubject,
        rejectEmailBody: parsed.data.rejectEmailBody === undefined ? undefined : parsed.data.rejectEmailBody,
      },
    });
    return res.json(updated);
  }),
);

cfpRouter.get(
  "/manage/:formId/dashboard",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const eventId = String(req.headers["x-event-id"] || "");
    await requireCfpManage(req.user!.id, eventId);
    const form = await loadFormForEvent(eventId, req.params.formId);

    const submissions = await prisma.cfpSubmission.findMany({
      where: { cfpFormId: form.id, emailVerifiedAt: { not: null } },
      select: { id: true, status: true, submittedAt: true, createdAt: true },
    });
    const byStatus: Record<string, number> = {};
    const overTime: Record<string, number> = {};
    for (const s of submissions) {
      byStatus[s.status] = (byStatus[s.status] || 0) + 1;
      const day = (s.submittedAt || s.createdAt).toISOString().slice(0, 10);
      overTime[day] = (overTime[day] || 0) + 1;
    }

    const reviewers = await prisma.cfpReviewer.findMany({
      where: { cfpFormId: form.id },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });
    const reviewerProgress = [];
    for (const r of reviewers) {
      const assigned = await prisma.cfpReview.count({ where: { reviewerUserId: r.userId, submission: { cfpFormId: form.id } } });
      const completed = await prisma.cfpReview.count({
        where: {
          reviewerUserId: r.userId,
          submission: { cfpFormId: form.id },
          recusedAt: null,
          NOT: { scores: { equals: {} } },
        },
      });
      reviewerProgress.push({
        userId: r.userId,
        name: r.user.name,
        email: r.user.email,
        assigned,
        completed,
      });
    }

    return res.json({
      formId: form.id,
      total: submissions.length,
      byStatus,
      overTime: Object.entries(overTime)
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      reviewerProgress,
    });
  }),
);

cfpRouter.get(
  "/manage/:formId/submissions",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const eventId = String(req.headers["x-event-id"] || "");
    await requireCfpManage(req.user!.id, eventId);
    const form = await loadFormForEvent(eventId, req.params.formId);
    const rubric = parseRubric(form.rubric);

    const rows = await prisma.cfpSubmission.findMany({
      where: { cfpFormId: form.id, emailVerifiedAt: { not: null } },
      include: {
        reviews: true,
        attachments: { select: { id: true, fileName: true, mime: true } },
        _count: { select: { reviews: true } },
      },
      orderBy: { submittedAt: "desc" },
    });

    const decisions = rows.map((s) => {
      const avg = weightedAverage(rubric, s.reviews);
      const reviewCount = s.reviews.filter((r) => !r.recusedAt && Object.keys((r.scores as object) || {}).length > 0).length;
      return {
        id: s.id,
        title: s.title,
        abstract: s.abstract,
        submitterName: s.submitterName,
        submitterEmail: s.submitterEmail,
        status: s.status,
        submittedAt: s.submittedAt,
        weightedAverage: avg,
        reviewCount,
        attachmentCount: s.attachments.length,
        convertedSessionId: s.convertedSessionId,
        convertedSessionItemId: s.convertedSessionItemId,
      };
    });

    decisions.sort((a, b) => {
      const aw = a.weightedAverage ?? -1;
      const bw = b.weightedAverage ?? -1;
      if (bw !== aw) return bw - aw;
      return b.reviewCount - a.reviewCount;
    });

    return res.json({ submissions: decisions, rubric, blindReview: form.blindReview });
  }),
);

cfpRouter.get(
  "/manage/:formId/export.csv",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const eventId = String(req.headers["x-event-id"] || "");
    await requireCfpManage(req.user!.id, eventId);
    const form = await loadFormForEvent(eventId, req.params.formId);
    const rubric = parseRubric(form.rubric);
    const rows = await prisma.cfpSubmission.findMany({
      where: { cfpFormId: form.id, emailVerifiedAt: { not: null } },
      include: { reviews: true },
      orderBy: { submittedAt: "asc" },
    });

    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [
      ["id", "title", "submitterName", "submitterEmail", "status", "weightedAverage", "reviewCount", "submittedAt"]
        .map(esc)
        .join(","),
    ];
    for (const s of rows) {
      const avg = weightedAverage(rubric, s.reviews);
      const reviewCount = s.reviews.filter((r) => !r.recusedAt).length;
      lines.push(
        [
          s.id,
          s.title,
          s.submitterName,
          s.submitterEmail,
          s.status,
          avg == null ? "" : String(avg),
          String(reviewCount),
          s.submittedAt?.toISOString() || "",
        ]
          .map(esc)
          .join(","),
      );
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="cfp-${form.id}.csv"`);
    return res.send(lines.join("\n"));
  }),
);

const reviewersSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1),
});

cfpRouter.post(
  "/manage/:formId/reviewers",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const eventId = String(req.headers["x-event-id"] || "");
    await requireCfpManage(req.user!.id, eventId);
    const form = await loadFormForEvent(eventId, req.params.formId);
    const parsed = reviewersSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const added = [];
    for (const userId of parsed.data.userIds) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) continue;
      await ensureReviewerMembership(prisma, eventId, userId);
      await prisma.cfpReviewer.upsert({
        where: { cfpFormId_userId: { cfpFormId: form.id, userId } },
        create: { cfpFormId: form.id, userId },
        update: {},
      });
      added.push({ userId, name: user.name, email: user.email });
    }
    return res.json({ reviewers: added });
  }),
);

cfpRouter.post(
  "/manage/:formId/assign",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const eventId = String(req.headers["x-event-id"] || "");
    await requireCfpManage(req.user!.id, eventId);
    const form = await loadFormForEvent(eventId, req.params.formId);
    const mode = req.body?.mode === "round_robin" ? "round_robin" : "all";
    const result = await assignReviews(prisma, form.id, mode);
    return res.json(result);
  }),
);

const decisionSchema = z.object({
  submissionIds: z.array(z.string().min(1)).min(1),
  decision: z.enum(["ACCEPT", "REJECT"]),
  queueEmail: z.boolean().optional(),
});

cfpRouter.post(
  "/manage/:formId/decisions",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const eventId = String(req.headers["x-event-id"] || "");
    const access = await requireCfpManage(req.user!.id, eventId);
    const form = await loadFormForEvent(eventId, req.params.formId);
    const parsed = decisionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const status =
      parsed.data.decision === "ACCEPT" ? CfpSubmissionStatus.ACCEPTED : CfpSubmissionStatus.REJECTED;
    const kind =
      parsed.data.decision === "ACCEPT" ? CfpDecisionEmailKind.ACCEPT : CfpDecisionEmailKind.REJECT;
    const subjectTpl =
      (parsed.data.decision === "ACCEPT" ? form.acceptEmailSubject : form.rejectEmailSubject) ||
      (parsed.data.decision === "ACCEPT" ? DEFAULT_ACCEPT_SUBJECT : DEFAULT_REJECT_SUBJECT);
    const bodyTpl =
      (parsed.data.decision === "ACCEPT" ? form.acceptEmailBody : form.rejectEmailBody) ||
      (parsed.data.decision === "ACCEPT" ? DEFAULT_ACCEPT_BODY : DEFAULT_REJECT_BODY);

    const emails = [];
    for (const id of parsed.data.submissionIds) {
      const sub = await prisma.cfpSubmission.findFirst({ where: { id, cfpFormId: form.id } });
      if (!sub) continue;
      await prisma.cfpSubmission.update({ where: { id }, data: { status } });
      if (parsed.data.queueEmail !== false) {
        const fields = {
          submitterName: sub.submitterName,
          title: sub.title,
          eventName: access.event.name,
          abstract: sub.abstract.slice(0, 500),
        };
        const email = await prisma.cfpDecisionEmail.create({
          data: {
            submissionId: id,
            kind,
            toEmail: sub.submitterEmail,
            subject: applyMergeFields(subjectTpl, fields),
            body: applyMergeFields(bodyTpl, fields),
            createdById: req.user!.id,
          },
        });
        emails.push(email);
      }
    }
    return res.json({ ok: true, status, queuedEmails: emails.length, emails });
  }),
);

cfpRouter.get(
  "/manage/:formId/emails",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const eventId = String(req.headers["x-event-id"] || "");
    await requireCfpManage(req.user!.id, eventId);
    const form = await loadFormForEvent(eventId, req.params.formId);
    const emails = await prisma.cfpDecisionEmail.findMany({
      where: { submission: { cfpFormId: form.id } },
      orderBy: { createdAt: "desc" },
    });
    return res.json({ emails });
  }),
);

cfpRouter.put(
  "/manage/emails/:emailId",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const eventId = String(req.headers["x-event-id"] || "");
    await requireCfpManage(req.user!.id, eventId);
    const email = await prisma.cfpDecisionEmail.findUnique({
      where: { id: req.params.emailId },
      include: { submission: { include: { cfpForm: true } } },
    });
    if (!email || email.submission.cfpForm.eventId !== eventId) {
      throw new HttpError(404, { error: "Email not found" });
    }
    if (email.sentAt) throw new HttpError(400, { error: "Already sent" });
    const subject = typeof req.body?.subject === "string" ? req.body.subject : email.subject;
    const body = typeof req.body?.body === "string" ? req.body.body : email.body;
    const updated = await prisma.cfpDecisionEmail.update({
      where: { id: email.id },
      data: { subject, body },
    });
    return res.json(updated);
  }),
);

cfpRouter.post(
  "/manage/emails/:emailId/send",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const eventId = String(req.headers["x-event-id"] || "");
    const access = await requireCfpManage(req.user!.id, eventId);
    const email = await prisma.cfpDecisionEmail.findUnique({
      where: { id: req.params.emailId },
      include: { submission: { include: { cfpForm: true } } },
    });
    if (!email || email.submission.cfpForm.eventId !== eventId) {
      throw new HttpError(404, { error: "Email not found" });
    }
    if (email.sentAt) throw new HttpError(400, { error: "Already sent" });

    await getEmailProvider().send({
      to: email.toEmail,
      from: process.env.RESEND_FROM_EMAIL || `${access.event.name} <noreply@example.com>`,
      subject: email.subject,
      logLabel: "cfp-decision",
      html: `<pre style="font-family:inherit;white-space:pre-wrap">${email.body
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")}</pre>`,
    });
    const updated = await prisma.cfpDecisionEmail.update({
      where: { id: email.id },
      data: { sentAt: new Date() },
    });
    return res.json(updated);
  }),
);

const convertSchema = z.object({
  items: z
    .array(
      z.object({
        submissionId: z.string().min(1),
        mode: z.enum(["standalone_session", "session_item"]),
        targetSessionId: z.string().optional(),
        additionalAuthors: z.array(z.string()).optional(),
      }),
    )
    .min(1),
});

cfpRouter.post(
  "/manage/:formId/convert",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const eventId = String(req.headers["x-event-id"] || "");
    await requireCfpManage(req.user!.id, eventId);
    const form = await loadFormForEvent(eventId, req.params.formId);
    const parsed = convertSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const results = [];
    for (const item of parsed.data.items) {
      const sub = await prisma.cfpSubmission.findFirst({
        where: { id: item.submissionId, cfpFormId: form.id },
      });
      if (!sub) continue;
      const result = await convertSubmission({
        prisma,
        submissionId: item.submissionId,
        mode: item.mode,
        targetSessionId: item.targetSessionId,
        additionalAuthors: item.additionalAuthors,
      });
      results.push(result);
    }

    // Changeset-shaped payload for ReviewChangeset UI
    const changeset = results.map((r, i) => ({
      kind: "create" as const,
      rowIndex: i,
      title: r.sessionItemId ? `SessionItem ${r.sessionItemId}` : `Session ${r.sessionId}`,
      sessionId: r.sessionId,
      sessionItemId: r.sessionItemId,
      speakerId: r.speakerId,
      authorOrder: r.authorOrder,
      accepted: true,
      message: r.sessionItemId
        ? `Paper added to session (${r.authorOrder.length} authors, order preserved)`
        : `Draft session created (${r.authorOrder.length} speakers)`,
    }));

    return res.json({
      results,
      changeset,
      reviewPath: `/organizer/events/${eventId}?tab=program&cfpConvert=1`,
    });
  }),
);

// ---------------------------------------------------------------------------
// Reviewer
// ---------------------------------------------------------------------------

cfpRouter.get(
  "/review/:formId/assignments",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { form, isManager, access } = await requireCfpReviewer(req.user!.id, req.params.formId);
    // REVIEWER must not receive manage flags
    if (!isManager && access.canManageEvent) {
      /* managers OK */
    }
    if (!isManager && !access.isEventReviewer && !access.canManageEvent) {
      // listed in CfpReviewer is enough (requireCfpReviewer already checked)
    }

    const rubric = parseRubric(form.rubric);
    const where = isManager
      ? { submission: { cfpFormId: form.id, emailVerifiedAt: { not: null } } }
      : { reviewerUserId: req.user!.id, submission: { cfpFormId: form.id } };

    const reviews = await prisma.cfpReview.findMany({
      where,
      include: {
        submission: {
          select: {
            id: true,
            title: true,
            abstract: true,
            status: true,
            submitterName: true,
            submitterEmail: true,
            submittedAt: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const blind = form.blindReview && !isManager;
    const assignments = reviews.map((r) => ({
      reviewId: r.id,
      scores: r.scores,
      comment: r.comment,
      recusedAt: r.recusedAt,
      submission: redactSubmitter(r.submission, blind),
    }));

    return res.json({
      formId: form.id,
      title: form.title,
      blindReview: form.blindReview,
      isManager,
      canManageEvent: false, // never expose manage to this surface
      rubric,
      assignments,
    });
  }),
);

const scoreSchema = z.object({
  scores: z.record(z.number()),
  comment: z.string().max(10_000).optional().nullable(),
  recuse: z.boolean().optional(),
});

cfpRouter.put(
  "/review/:formId/reviews/:reviewId",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { form, isManager } = await requireCfpReviewer(req.user!.id, req.params.formId);
    const review = await prisma.cfpReview.findUnique({ where: { id: req.params.reviewId } });
    if (!review) throw new HttpError(404, { error: "Review not found" });
    if (!isManager && review.reviewerUserId !== req.user!.id) {
      throw new HttpError(403, { error: "Forbidden" });
    }
    const parsed = scoreSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    if (parsed.data.recuse) {
      const updated = await prisma.cfpReview.update({
        where: { id: review.id },
        data: { recusedAt: new Date(), comment: parsed.data.comment ?? review.comment },
      });
      return res.json(updated);
    }

    const rubric = parseRubric(form.rubric);
    assertScoreMap(rubric, parsed.data.scores);
    const updated = await prisma.cfpReview.update({
      where: { id: review.id },
      data: {
        scores: parsed.data.scores as Prisma.InputJsonValue,
        comment: parsed.data.comment === undefined ? undefined : parsed.data.comment,
        recusedAt: null,
      },
    });
    return res.json(updated);
  }),
);

/** Prove REVIEWER cannot manage — used by tenancy tests. */
cfpRouter.get(
  "/review/:formId/probe-manage",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const eventId = String(req.headers["x-event-id"] || "");
    // Intentionally use manage gate — REVIEWER must 403
    await requireEventAccess(req.user!.id, eventId, { manage: true });
    return res.json({ ok: true });
  }),
);
