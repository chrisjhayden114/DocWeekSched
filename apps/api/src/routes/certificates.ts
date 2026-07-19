/**
 * Phase P4 — Certificate templates, issue, batch, attendee download, public verify.
 */

import { Router } from "express";
import { z } from "zod";
import { CertificateEligibilityRule } from "@prisma/client";
import { asyncHandler, HttpError, requireEventAccess } from "../lib/authorization";
import { prisma } from "../lib/db";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";
import { can, upgradePayload } from "../lib/billing/entitlements";
import { requireFeature, featureEnabled } from "../lib/features";
import { authRateLimit } from "../lib/rateLimit";
import {
  enqueueCertificateBatchIssue,
  issueCertificateForUser,
  renderCertificatePdf,
  validateTemplateEligibility,
  formatCertificateDates,
} from "../lib/certificates";

export const certificatesRouter = Router();
export const verifyRouter = Router();

const eligibilityRuleSchema = z.nativeEnum(CertificateEligibilityRule);

const templateBodySchema = z.object({
  name: z.string().min(1).max(200),
  titleText: z.string().min(1).max(500),
  bodyText: z.string().max(8000).nullable().optional(),
  signatureImageUrl: z.string().max(500_000).nullable().optional(),
  hours: z.number().finite().nonnegative().nullable().optional(),
  eligibilityRule: eligibilityRuleSchema,
  minSessions: z.number().int().nullable().optional(),
  requiredSessionIds: z.array(z.string()).optional(),
});

async function assertCertificatesPlan(organizationId: string): Promise<void> {
  if (!(await can(organizationId, "certificates"))) {
    throw new HttpError(402, {
      error: "Certificates require a Per-event or Pro plan",
      upgrade: upgradePayload({
        code: "FEATURE_LOCKED",
        message: "Upgrade to unlock certificate templates and batch issue.",
      }),
    });
  }
}

function pdfFromStorageKey(key: string | null): Buffer | null {
  if (!key) return null;
  const m = /^data:application\/pdf;base64,(.+)$/i.exec(key.trim());
  if (!m) return null;
  try {
    return Buffer.from(m[1]!, "base64");
  } catch {
    return null;
  }
}

certificatesRouter.get(
  "/event/:eventId/templates",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const access = await requireEventAccess(req.user!.id, req.params.eventId, { manage: true });
    await assertCertificatesPlan(access.event.organizationId);
    const templates = await prisma.certificateTemplate.findMany({
      where: { eventId: access.event.id, organizationId: access.event.organizationId },
      orderBy: { createdAt: "asc" },
    });
    return res.json({
      templates,
      /** Honest copy for organizer UI: session rules are registration (JOINING), not door check-in. */
      sessionEligibilityNote:
        "Session eligibility (MIN_SESSIONS / REQUIRED_SESSIONS) is based on session registration (joined), not verified door attendance.",
    });
  }),
);

certificatesRouter.post(
  "/event/:eventId/templates",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const access = await requireEventAccess(req.user!.id, req.params.eventId, { manage: true });
    await assertCertificatesPlan(access.event.organizationId);

    const parsed = templateBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, { error: "Invalid certificate template", details: parsed.error.flatten() });
    }

    const validated = await validateTemplateEligibility({
      eventId: access.event.id,
      eligibilityRule: parsed.data.eligibilityRule,
      minSessions: parsed.data.minSessions,
      requiredSessionIds: parsed.data.requiredSessionIds,
    });

    const template = await prisma.certificateTemplate.create({
      data: {
        organizationId: access.event.organizationId,
        eventId: access.event.id,
        name: parsed.data.name,
        titleText: parsed.data.titleText,
        bodyText: parsed.data.bodyText ?? null,
        signatureImageUrl: parsed.data.signatureImageUrl ?? null,
        hours: parsed.data.hours ?? null,
        eligibilityRule: parsed.data.eligibilityRule,
        minSessions: validated.minSessions,
        requiredSessionIds: validated.requiredSessionIds,
      },
    });
    return res.status(201).json({ template });
  }),
);

certificatesRouter.put(
  "/templates/:templateId",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const existing = await prisma.certificateTemplate.findUnique({
      where: { id: req.params.templateId },
    });
    if (!existing) throw new HttpError(404, { error: "Template not found" });

    const access = await requireEventAccess(req.user!.id, existing.eventId, { manage: true });
    if (existing.organizationId !== access.event.organizationId) {
      throw new HttpError(404, { error: "Template not found" });
    }
    await assertCertificatesPlan(access.event.organizationId);

    const parsed = templateBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, { error: "Invalid certificate template", details: parsed.error.flatten() });
    }

    const validated = await validateTemplateEligibility({
      eventId: existing.eventId,
      eligibilityRule: parsed.data.eligibilityRule,
      minSessions: parsed.data.minSessions,
      requiredSessionIds: parsed.data.requiredSessionIds,
    });

    const template = await prisma.certificateTemplate.update({
      where: { id: existing.id },
      data: {
        name: parsed.data.name,
        titleText: parsed.data.titleText,
        bodyText: parsed.data.bodyText ?? null,
        signatureImageUrl: parsed.data.signatureImageUrl ?? null,
        hours: parsed.data.hours ?? null,
        eligibilityRule: parsed.data.eligibilityRule,
        minSessions: validated.minSessions,
        requiredSessionIds: validated.requiredSessionIds,
      },
    });
    return res.json({ template });
  }),
);

certificatesRouter.post(
  "/templates/:templateId/issue",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = z.object({ userId: z.string().min(1) }).safeParse(req.body);
    if (!body.success) throw new HttpError(400, { error: "userId required" });

    const template = await prisma.certificateTemplate.findUnique({
      where: { id: req.params.templateId },
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
    if (!template) throw new HttpError(404, { error: "Template not found" });

    const access = await requireEventAccess(req.user!.id, template.eventId, { manage: true });
    if (template.organizationId !== access.event.organizationId) {
      throw new HttpError(404, { error: "Template not found" });
    }
    await assertCertificatesPlan(access.event.organizationId);

    const membership = await prisma.eventMembership.findFirst({
      where: { eventId: template.eventId, userId: body.data.userId, deletedAt: null },
    });
    if (!membership) throw new HttpError(404, { error: "Attendee not on active roster" });

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: body.data.userId },
      select: { id: true, name: true, email: true },
    });

    const result = await issueCertificateForUser({
      template,
      user,
      issuedByUserId: req.user!.id,
    });
    if (!result) throw new HttpError(400, { error: "Attendee is not eligible for this certificate" });
    return res.json({ certificate: result });
  }),
);

certificatesRouter.post(
  "/templates/:templateId/batch",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = z
      .object({ sendReadyEmail: z.boolean().optional() })
      .safeParse(req.body ?? {});
    if (!body.success) throw new HttpError(400, { error: "Invalid batch options" });

    const template = await prisma.certificateTemplate.findUnique({
      where: { id: req.params.templateId },
    });
    if (!template) throw new HttpError(404, { error: "Template not found" });

    const access = await requireEventAccess(req.user!.id, template.eventId, { manage: true });
    if (template.organizationId !== access.event.organizationId) {
      throw new HttpError(404, { error: "Template not found" });
    }
    await assertCertificatesPlan(access.event.organizationId);

    const job = await enqueueCertificateBatchIssue({
      certificateTemplateId: template.id,
      organizationId: template.organizationId,
      eventId: template.eventId,
      createdById: req.user!.id,
      sendReadyEmail: body.data.sendReadyEmail,
    });
    return res.status(202).json({ jobId: job.id });
  }),
);

/** Per-attendee download after the event (plan + feature gate). */
certificatesRouter.get(
  "/event/:eventId/mine",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const access = await requireEventAccess(req.user!.id, req.params.eventId);
    await assertCertificatesPlan(access.event.organizationId);
    await requireFeature(access.event.id, "certificates");

    const now = new Date();
    if (access.event.endDate && access.event.endDate.getTime() > now.getTime()) {
      throw new HttpError(403, { error: "Certificates are available after the event ends" });
    }

    const rows = await prisma.issuedCertificate.findMany({
      where: {
        eventId: access.event.id,
        userId: req.user!.id,
        voidedAt: null,
        organizationId: access.event.organizationId,
      },
      select: {
        id: true,
        publicId: true,
        issuedAt: true,
        regeneratedAt: true,
        hoursSnapshot: true,
        certificateTemplate: { select: { id: true, name: true } },
      },
      orderBy: { issuedAt: "desc" },
    });
    return res.json({ certificates: rows });
  }),
);

certificatesRouter.get(
  "/event/:eventId/mine/:publicId/pdf",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const access = await requireEventAccess(req.user!.id, req.params.eventId);
    await assertCertificatesPlan(access.event.organizationId);
    if (!(await featureEnabled(access.event.id, "certificates"))) {
      throw new HttpError(404, { error: "Feature not available for this event" });
    }

    const row = await prisma.issuedCertificate.findFirst({
      where: {
        publicId: req.params.publicId,
        eventId: access.event.id,
        userId: req.user!.id,
        voidedAt: null,
        organizationId: access.event.organizationId,
      },
      include: {
        certificateTemplate: true,
        event: {
          select: { name: true, startDate: true, endDate: true, timezone: true },
        },
      },
    });
    if (!row) throw new HttpError(404, { error: "Certificate not found" });

    let pdf = pdfFromStorageKey(row.pdfStorageKey);
    if (!pdf) {
      pdf = await renderCertificatePdf({
        titleText: row.certificateTemplate.titleText,
        bodyText: row.certificateTemplate.bodyText,
        signatureImageUrl: row.certificateTemplate.signatureImageUrl,
        merge: {
          attendeeName: row.attendeeNameSnapshot,
          eventName: row.eventNameSnapshot,
          dates: formatCertificateDates(row.event.startDate, row.event.endDate, row.event.timezone),
          hours: row.hoursSnapshot,
          signatureImage: row.certificateTemplate.signatureImageUrl,
          certificateId: row.publicId,
        },
      });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="certificate-${row.publicId}.pdf"`);
    return res.send(pdf);
  }),
);

/**
 * Public verification — lookup by publicId only.
 * Voided rows are treated as a miss (identical 404).
 */
verifyRouter.get(
  "/:certificateId",
  authRateLimit({ windowMs: 60_000, max: 30 }),
  asyncHandler(async (req, res) => {
    const certificateId = String(req.params.certificateId || "").trim();
    const notFound = () => res.status(404).json({ error: "Not found" });

    if (!certificateId || certificateId.length > 64) {
      return notFound();
    }

    const row = await prisma.issuedCertificate.findUnique({
      where: { publicId: certificateId },
      select: {
        attendeeNameSnapshot: true,
        eventNameSnapshot: true,
        eventDateSnapshot: true,
        voidedAt: true,
      },
    });

    if (!row || row.voidedAt) {
      return notFound();
    }

    const d = row.eventDateSnapshot;
    const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

    return res.json({
      attendeeName: row.attendeeNameSnapshot,
      eventName: row.eventNameSnapshot,
      date,
    });
  }),
);
