/**
 * Phase A6 — Post-event recap organizer API.
 */

import { Router } from "express";
import { z } from "zod";
import { RecapEmailStatus, RecapSectionStatus } from "@prisma/client";
import { asyncHandler, HttpError, requireEventAccess } from "../lib/authorization";
import { prisma } from "../lib/db";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";
import { can, upgradePayload } from "../lib/billing/entitlements";
import { requireFeature } from "../lib/features";
import { resolveEventFromRequest } from "../lib/requestEvent";
import { validationErrorBody } from "../lib/errors";
import {
  enqueueRecapGenerate,
  generateEventRecap,
  metricsSnapshotToCsv,
  metricsSnapshotToPlainReport,
  sendRecapEmail,
  type RecapMetricsSnapshot,
} from "../lib/ai/recap";

export const recapRouter = Router();

async function assertRecapPlan(organizationId: string): Promise<void> {
  if (!(await can(organizationId, "recap_agent"))) {
    throw new HttpError(402, {
      error: "Post-event recap requires a Pro plan",
      upgrade: upgradePayload({
        code: "FEATURE_LOCKED",
        message: "Upgrade to Pro to unlock the post-event recap agent.",
      }),
    });
  }
}

async function loadEventForRecap(req: AuthedRequest) {
  const event = await resolveEventFromRequest(req);
  await requireEventAccess(req.user!.id, event.id, { manage: true });
  await assertRecapPlan(event.organizationId);
  await requireFeature(event.id, "recap_agent");
  return event;
}

function assertEventEnded(endDate: Date): void {
  if (Date.now() < endDate.getTime()) {
    throw new HttpError(403, {
      error: "Recap can only be generated after the event endDate",
      code: "EVENT_NOT_ENDED",
    });
  }
}

/** GET workspace (or empty shell if none yet). */
recapRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await loadEventForRecap(req);
    const recap = await prisma.eventRecap.findUnique({
      where: { eventId: event.id },
      include: {
        sections: {
          where: { status: RecapSectionStatus.DRAFT },
          orderBy: { createdAt: "asc" },
        },
        emails: {
          where: { status: { in: [RecapEmailStatus.DRAFT, RecapEmailStatus.SENT] } },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    return res.json({
      eventId: event.id,
      endDate: event.endDate,
      canGenerate: Date.now() >= event.endDate.getTime(),
      recap,
      aiGeneratedLabel: true,
    });
  }),
);

const generateSchema = z.object({
  /** When true, run inline (tests / sync). Default enqueues background job. */
  sync: z.boolean().optional().default(false),
});

/** POST generate / regenerate. */
recapRouter.post(
  "/generate",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await loadEventForRecap(req);
    assertEventEnded(event.endDate);

    const parsed = generateSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new HttpError(400, validationErrorBody(parsed.error));

    if (parsed.data.sync) {
      const result = await generateEventRecap({
        eventId: event.id,
        organizationId: event.organizationId,
        createdById: req.user!.id,
      });
      const recap = await prisma.eventRecap.findUniqueOrThrow({
        where: { id: result.recapId },
        include: {
          sections: { where: { status: RecapSectionStatus.DRAFT }, orderBy: { createdAt: "asc" } },
          emails: {
            where: { status: { in: [RecapEmailStatus.DRAFT, RecapEmailStatus.SENT] } },
            orderBy: { createdAt: "asc" },
          },
        },
      });
      return res.status(200).json({ ...result, recap });
    }

    // Ensure PENDING workspace exists for UI polling.
    await prisma.eventRecap.upsert({
      where: { eventId: event.id },
      create: {
        organizationId: event.organizationId,
        eventId: event.id,
        status: "PENDING",
      },
      update: {},
    });

    const job = await enqueueRecapGenerate({
      eventId: event.id,
      organizationId: event.organizationId,
      createdById: req.user!.id,
    });

    await prisma.eventRecap.update({
      where: { eventId: event.id },
      data: { lastJobId: job.id, status: "PENDING" },
    });

    return res.status(202).json({ jobId: job.id, status: "PENDING" });
  }),
);

const editSectionSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  bodyMarkdown: z.string().max(100_000).optional(),
});

recapRouter.patch(
  "/sections/:sectionId",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await loadEventForRecap(req);
    const parsed = editSectionSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, validationErrorBody(parsed.error, "Invalid body"));

    const section = await prisma.eventRecapSection.findFirst({
      where: {
        id: req.params.sectionId,
        status: RecapSectionStatus.DRAFT,
        recap: { eventId: event.id },
      },
    });
    if (!section) throw new HttpError(404, { error: "Section not found" });

    const updated = await prisma.eventRecapSection.update({
      where: { id: section.id },
      data: {
        ...(parsed.data.title != null ? { title: parsed.data.title.trim() } : {}),
        ...(parsed.data.bodyMarkdown != null ? { bodyMarkdown: parsed.data.bodyMarkdown } : {}),
      },
    });
    return res.json({ section: updated, aiGenerated: updated.aiGenerated });
  }),
);

const editEmailSchema = z.object({
  subject: z.string().min(1).max(200).optional(),
  body: z.string().max(50_000).optional(),
});

recapRouter.patch(
  "/emails/:emailId",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await loadEventForRecap(req);
    const parsed = editEmailSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, validationErrorBody(parsed.error, "Invalid body"));

    const email = await prisma.eventRecapEmail.findFirst({
      where: {
        id: req.params.emailId,
        status: RecapEmailStatus.DRAFT,
        recap: { eventId: event.id },
      },
    });
    if (!email) throw new HttpError(404, { error: "Email draft not found" });

    const updated = await prisma.eventRecapEmail.update({
      where: { id: email.id },
      data: {
        ...(parsed.data.subject != null ? { subject: parsed.data.subject.trim() } : {}),
        ...(parsed.data.body != null ? { body: parsed.data.body } : {}),
      },
    });
    return res.json({ email: updated, aiGenerated: updated.aiGenerated });
  }),
);

/** Explicit send — announcements email path + rate limit. */
recapRouter.post(
  "/emails/:emailId/send",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await loadEventForRecap(req);
    const result = await sendRecapEmail({
      recapEmailId: req.params.emailId,
      eventId: event.id,
      actorId: req.user!.id,
    });
    return res.json(result);
  }),
);

recapRouter.get(
  "/export.csv",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await loadEventForRecap(req);
    const recap = await prisma.eventRecap.findUnique({ where: { eventId: event.id } });
    if (!recap) throw new HttpError(404, { error: "Recap not found" });
    const snapshot = recap.metricsSnapshot as unknown as RecapMetricsSnapshot;
    const csv = metricsSnapshotToCsv(snapshot);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="recap-${event.id}.csv"`);
    return res.send(csv);
  }),
);

recapRouter.get(
  "/export.txt",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await loadEventForRecap(req);
    const recap = await prisma.eventRecap.findUnique({
      where: { eventId: event.id },
      include: {
        sections: {
          where: { kind: "REPORT", status: RecapSectionStatus.DRAFT },
          take: 1,
        },
      },
    });
    if (!recap) throw new HttpError(404, { error: "Recap not found" });
    const snapshot = recap.metricsSnapshot as unknown as RecapMetricsSnapshot;
    const report = recap.sections[0]?.bodyMarkdown ?? "";
    const text = metricsSnapshotToPlainReport(snapshot, report);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="recap-${event.id}.txt"`);
    return res.send(text);
  }),
);
