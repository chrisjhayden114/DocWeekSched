import { Router } from "express";
import { z } from "zod";
import {
  AgendaIngestRunStatus,
  AgendaIngestSourceKind,
  type Prisma,
} from "@prisma/client";
import { asyncHandler, HttpError, requireEventAccess } from "../lib/authorization";
import { assertAiCap, writeAuditLog } from "../lib/ai";
import {
  AGENDA_INGEST_JOB_TYPE,
  AGENDA_INGEST_MAX_BYTES,
  INGEST_ALLOWED_MIME,
  confirmAgendaChangeset,
  fetchUrlText,
  previewText,
  textFromDataUrl,
  type ChangesetRow,
} from "../lib/ai/ingest";
import { prisma } from "../lib/db";
import { enqueueJob, processDueJobs } from "../lib/jobs";
import type { AuthedRequest } from "../lib/middleware";
import { requireAuth, requireCsrf } from "../lib/middleware";
import { resolveEventFromRequest } from "../lib/requestEvent";
import { getStorageProvider } from "../lib/storage";
import { validationErrorBody } from "../lib/errors";

export const agendaIngestRouter = Router();

const startSchema = z.object({
  sourceKind: z.nativeEnum(AgendaIngestSourceKind),
  text: z.string().max(AGENDA_INGEST_MAX_BYTES).optional(),
  url: z.string().url().optional(),
  fileUrl: z.string().optional(),
  fileName: z.string().max(260).optional(),
  mime: z.string().max(120).optional(),
  processInline: z.boolean().optional(),
});

const reviewSchema = z.object({
  changeset: z.array(z.record(z.unknown())).optional(),
  reviewState: z.record(z.unknown()).optional(),
  assumptions: z
    .array(
      z.object({
        id: z.string(),
        question: z.string().optional(),
        answer: z.string().optional(),
        defaultAnswer: z.string().optional(),
        appliesTo: z.string().optional(),
      }),
    )
    .optional(),
});

const confirmSchema = z.object({
  changeset: z.array(z.record(z.unknown())).optional(),
});

function asChangesetRows(raw: unknown): ChangesetRow[] {
  if (!Array.isArray(raw)) return [];
  return raw as ChangesetRow[];
}

agendaIngestRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });

    const runs = await prisma.agendaIngestRun.findMany({
      where: { eventId: event.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        sourceKind: true,
        sourceFileName: true,
        status: true,
        createdCount: true,
        updatedCount: true,
        deletedCount: true,
        speakerCount: true,
        itemCount: true,
        error: true,
        confirmedAt: true,
        createdAt: true,
        createdById: true,
        jobId: true,
        aiGenerated: true,
      },
    });

    const audit = await prisma.auditLog.findMany({
      where: {
        eventId: event.id,
        entityType: "agenda_ingest_run",
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        action: true,
        entityId: true,
        createdAt: true,
        aiGenerated: true,
        payload: true,
      },
    });

    return res.json({ runs, audit });
  }),
);

agendaIngestRouter.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });

    const run = await prisma.agendaIngestRun.findFirst({
      where: { id: req.params.id, eventId: event.id },
    });
    if (!run) throw new HttpError(404, { error: "Ingest run not found" });
    return res.json(run);
  }),
);

agendaIngestRouter.post(
  "/",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = startSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(validationErrorBody(parsed.error));
    }

    const event = await resolveEventFromRequest(req);
    const access = await requireEventAccess(req.user!.id, event.id, { manage: true });

    await assertAiCap(event.organizationId, event.id, "AGENDA_INGEST");

    let sourceText = "";
    let sourceUrl: string | null = null;
    let sourceStorageKey: string | null = null;
    let sourceMime = parsed.data.mime || null;
    let sourceBytes: number | null = null;
    let sourceFileName = parsed.data.fileName || null;

    if (parsed.data.sourceKind === AgendaIngestSourceKind.PASTE) {
      sourceText = (parsed.data.text || "").trim();
      if (!sourceText) throw new HttpError(400, { error: "Paste text is required" });
      sourceBytes = Buffer.byteLength(sourceText, "utf8");
    } else if (parsed.data.sourceKind === AgendaIngestSourceKind.URL) {
      const url = parsed.data.url || parsed.data.fileUrl;
      if (!url) throw new HttpError(400, { error: "URL is required" });
      const fetched = await fetchUrlText(url);
      sourceText = fetched.text;
      sourceUrl = url;
      sourceMime = fetched.mime;
      sourceBytes = Buffer.byteLength(sourceText, "utf8");
      sourceFileName = sourceFileName || url;
    } else if (parsed.data.fileUrl) {
      const stored = await getStorageProvider().acceptUpload({
        url: parsed.data.fileUrl,
        keyPrefix: `events/${event.id}/agenda-ingest`,
        maxBytes: AGENDA_INGEST_MAX_BYTES,
        allowedMimeTypes: INGEST_ALLOWED_MIME,
      });
      sourceUrl = stored.url;
      sourceStorageKey = stored.storageKey;
      if (stored.url.startsWith("data:")) {
        sourceText = textFromDataUrl(stored.url);
        const m = /^data:([^;,]+)/i.exec(stored.url);
        sourceMime = sourceMime || m?.[1] || null;
        const b64 = stored.url.split(",")[1] || "";
        sourceBytes = Buffer.from(b64, "base64").length;
      } else if (parsed.data.text) {
        sourceText = parsed.data.text;
      } else {
        sourceText = parsed.data.text || `[Stored file ${sourceFileName || "upload"}]`;
      }
    } else if (parsed.data.text) {
      sourceText = parsed.data.text;
      sourceBytes = Buffer.byteLength(sourceText, "utf8");
    } else {
      throw new HttpError(400, { error: "Provide text, url, or fileUrl" });
    }

    if (sourceBytes != null && sourceBytes > AGENDA_INGEST_MAX_BYTES) {
      throw new HttpError(400, {
        error: `File exceeds max size of ${AGENDA_INGEST_MAX_BYTES} bytes`,
      });
    }

    const run = await prisma.agendaIngestRun.create({
      data: {
        organizationId: event.organizationId,
        eventId: event.id,
        createdById: req.user!.id,
        sourceKind: parsed.data.sourceKind,
        sourceFileName,
        sourceMime,
        sourceBytes,
        sourceUrl,
        sourceStorageKey,
        sourceTextPreview: previewText(sourceText),
        status: AgendaIngestRunStatus.PENDING,
        aiGenerated: true,
      },
    });

    const job = await enqueueJob({
      type: AGENDA_INGEST_JOB_TYPE,
      organizationId: event.organizationId,
      eventId: event.id,
      createdById: req.user!.id,
      payload: { runId: run.id, sourceText },
      maxAttempts: 1,
    });

    await prisma.agendaIngestRun.update({
      where: { id: run.id },
      data: { jobId: job.id },
    });

    await writeAuditLog({
      organizationId: event.organizationId,
      eventId: event.id,
      actorUserId: req.user!.id,
      action: "JOB_ENQUEUE",
      entityType: "agenda_ingest_run",
      entityId: run.id,
      aiGenerated: true,
      payload: { jobId: job.id, sourceKind: parsed.data.sourceKind },
    });

    if (parsed.data.processInline || process.env.AGENDA_INGEST_INLINE === "1") {
      await processDueJobs(10);
    }

    const fresh = await prisma.agendaIngestRun.findUniqueOrThrow({ where: { id: run.id } });
    return res.status(201).json({
      run: fresh,
      jobId: job.id,
      organizationId: access.event.organizationId,
    });
  }),
);

agendaIngestRouter.patch(
  "/:id",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(validationErrorBody(parsed.error));
    }

    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });

    const run = await prisma.agendaIngestRun.findFirst({
      where: { id: req.params.id, eventId: event.id },
    });
    if (!run) throw new HttpError(404, { error: "Ingest run not found" });
    if (
      run.status !== AgendaIngestRunStatus.READY_FOR_REVIEW &&
      run.status !== AgendaIngestRunStatus.CONFIRMING
    ) {
      throw new HttpError(400, { error: "Run is not editable in its current status" });
    }

    const updated = await prisma.agendaIngestRun.update({
      where: { id: run.id },
      data: {
        ...(parsed.data.changeset
          ? { changeset: parsed.data.changeset as Prisma.InputJsonValue }
          : {}),
        ...(parsed.data.reviewState
          ? { reviewState: parsed.data.reviewState as Prisma.InputJsonValue }
          : {}),
        ...(parsed.data.assumptions
          ? { assumptions: parsed.data.assumptions as Prisma.InputJsonValue }
          : {}),
      },
    });
    return res.json(updated);
  }),
);

agendaIngestRouter.post(
  "/:id/confirm",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = confirmSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json(validationErrorBody(parsed.error));
    }

    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });

    const run = await prisma.agendaIngestRun.findFirst({
      where: { id: req.params.id, eventId: event.id },
    });
    if (!run) throw new HttpError(404, { error: "Ingest run not found" });
    if (run.status !== AgendaIngestRunStatus.READY_FOR_REVIEW) {
      throw new HttpError(400, { error: "Run is not ready for confirm" });
    }

    const rows = asChangesetRows(parsed.data.changeset ?? run.changeset);
    if (!rows.length) {
      throw new HttpError(400, { error: "Nothing to confirm" });
    }

    await prisma.agendaIngestRun.update({
      where: { id: run.id },
      data: {
        status: AgendaIngestRunStatus.CONFIRMING,
        changeset: rows as unknown as Prisma.InputJsonValue,
      },
    });

    const counts = await confirmAgendaChangeset({
      prisma,
      organizationId: event.organizationId,
      eventId: event.id,
      timezone: event.timezone,
      actorUserId: req.user!.id,
      runId: run.id,
      rows,
    });

    const confirmed = await prisma.agendaIngestRun.update({
      where: { id: run.id },
      data: {
        status: AgendaIngestRunStatus.CONFIRMED,
        confirmedAt: new Date(),
        createdCount: counts.createdCount,
        updatedCount: counts.updatedCount,
        deletedCount: counts.deletedCount,
        speakerCount: counts.speakerCount,
        itemCount: counts.itemCount,
      },
    });

    return res.json({ run: confirmed, ...counts });
  }),
);
