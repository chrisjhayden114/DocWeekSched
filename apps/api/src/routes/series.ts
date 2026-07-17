import { OrgRole } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler, HttpError, requireEventAccess, requireOrgRole } from "../lib/authorization";
import { prisma } from "../lib/db";
import { cloneNextEdition } from "../lib/seriesClone";
import { resolveEventFromRequest } from "../lib/requestEvent";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";

export const seriesRouter = Router();

const nextEditionSchema = z.object({
  sourceEventId: z.string().min(1),
  organizationId: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().optional(),
  timezone: z.string().min(1).optional(),
  slug: z
    .string()
    .min(2)
    .max(72)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional(),
});

seriesRouter.post(
  "/next-edition",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = nextEditionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    await requireOrgRole(req.user!.id, parsed.data.organizationId, OrgRole.STAFF);
    await requireEventAccess(req.user!.id, parsed.data.sourceEventId, { manage: true });

    try {
      const result = await cloneNextEdition(prisma, {
        sourceEventId: parsed.data.sourceEventId,
        organizationId: parsed.data.organizationId,
        createdById: req.user!.id,
        name: parsed.data.name,
        startDate: new Date(parsed.data.startDate),
        endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : undefined,
        timezone: parsed.data.timezone,
        slug: parsed.data.slug,
      });
      return res.status(201).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Clone failed";
      throw new HttpError(400, { error: message });
    }
  }),
);

const consentSchema = z.object({
  seriesId: z.string().min(1),
  consented: z.boolean(),
});

/** Returning attendee continuity consent when joining a later edition. */
seriesRouter.post(
  "/continuity-consent",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = consentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const series = await prisma.eventSeries.findUnique({ where: { id: parsed.data.seriesId } });
    if (!series) return res.status(404).json({ error: "Series not found" });

    const member = await prisma.eventMembership.findFirst({
      where: {
        userId: req.user!.id,
        event: { seriesId: series.id },
      },
    });
    if (!member) {
      throw new HttpError(403, { error: "Join an edition of this series first" });
    }

    if (!parsed.data.consented) {
      await prisma.seriesContinuityConsent.deleteMany({
        where: { seriesId: series.id, userId: req.user!.id },
      });
      return res.json({ ok: true, consented: false });
    }

    const row = await prisma.seriesContinuityConsent.upsert({
      where: {
        seriesId_userId: { seriesId: series.id, userId: req.user!.id },
      },
      create: { seriesId: series.id, userId: req.user!.id },
      update: {},
    });
    return res.json({ ok: true, consented: true, consentedAt: row.consentedAt });
  }),
);

/** Prompt payload for the current event (if series + prior editions + no consent yet). */
seriesRouter.get(
  "/continuity-prompt",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id);

    if (!event.seriesId) {
      return res.json({ prompt: false });
    }

    const prior = await prisma.eventMembership.findFirst({
      where: {
        userId: req.user!.id,
        event: {
          seriesId: event.seriesId,
          id: { not: event.id },
        },
      },
      include: { event: { select: { name: true, startDate: true } } },
    });
    if (!prior) {
      return res.json({ prompt: false });
    }

    const existing = await prisma.seriesContinuityConsent.findUnique({
      where: {
        seriesId_userId: { seriesId: event.seriesId, userId: req.user!.id },
      },
    });
    if (existing) {
      return res.json({ prompt: false, consented: true });
    }

    const series = await prisma.eventSeries.findUniqueOrThrow({ where: { id: event.seriesId } });
    return res.json({
      prompt: true,
      seriesId: series.id,
      seriesName: series.name,
      priorEventName: prior.event.name,
      message:
        "You've attended a previous edition. Keep your profile and connections across years?",
    });
  }),
);

seriesRouter.get(
  "/:seriesId",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const series = await prisma.eventSeries.findUnique({
      where: { id: req.params.seriesId },
      include: {
        events: {
          orderBy: { startDate: "desc" },
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
            startDate: true,
            endDate: true,
          },
        },
      },
    });
    if (!series) return res.status(404).json({ error: "Series not found" });
    await requireOrgRole(req.user!.id, series.organizationId, OrgRole.STAFF);
    return res.json(series);
  }),
);
