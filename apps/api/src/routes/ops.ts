import { Router } from "express";
import { z } from "zod";
import { asyncHandler, HttpError, requireEventAccess } from "../lib/authorization";
import {
  applyOpsCard,
  dismissOpsCard,
  editOpsCard,
  enqueueOpsDetectForEvent,
  isOpsInboxActive,
  listOpsCards,
  opsInboxWindow,
  runOpsDetectorsForEvent,
} from "../lib/ai/ops";
import { prisma } from "../lib/db";
import { requireFeature } from "../lib/features";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";
import { resolveEventFromRequest } from "../lib/requestEvent";

export const opsRouter = Router();

const editSchema = z.object({
  draftTitle: z.string().min(1).max(200).optional(),
  draftBody: z.string().min(1).max(10_000).optional(),
  draftPayload: z.record(z.unknown()).optional(),
});

const blocklistSchema = z.object({
  communityBlocklist: z.array(z.string().min(1).max(80)).max(100),
});

opsRouter.get(
  "/inbox",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    await requireFeature(event.id, "ops_agent");

    const full = await prisma.event.findUnique({
      where: { id: event.id },
      select: {
        id: true,
        startDate: true,
        endDate: true,
        timezone: true,
        communityBlocklist: true,
      },
    });
    if (!full) throw new HttpError(404, { error: "Event not found" });

    const now = new Date();
    const active = isOpsInboxActive(full, now);
    const window = opsInboxWindow(full);
    const statusParam = String(req.query.status || "OPEN").toUpperCase();
    const status =
      statusParam === "ALL" || statusParam === "APPLIED" || statusParam === "DISMISSED"
        ? (statusParam as "ALL" | "APPLIED" | "DISMISSED")
        : "OPEN";

    const cards = active || status !== "OPEN" ? await listOpsCards(event.id, { status }) : [];

    return res.json({
      active,
      window: { openAt: window.openAt.toISOString(), closeAt: window.closeAt.toISOString() },
      communityBlocklist: full.communityBlocklist,
      cards,
    });
  }),
);

opsRouter.post(
  "/inbox/run-detectors",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    await requireFeature(event.id, "ops_agent");

    const full = await prisma.event.findUnique({
      where: { id: event.id },
      select: { organizationId: true, startDate: true, endDate: true },
    });
    if (!full) throw new HttpError(404, { error: "Event not found" });
    if (!isOpsInboxActive(full)) {
      throw new HttpError(400, { error: "Ops Inbox is outside its active window" });
    }

    const sync = String(req.query.sync || "") === "1" || req.body?.sync === true;
    if (sync) {
      const result = await runOpsDetectorsForEvent(event.id, { forceDigest: true });
      return res.json(result);
    }

    const enqueued = await enqueueOpsDetectForEvent({
      eventId: event.id,
      organizationId: full.organizationId,
      createdById: req.user!.id,
    });
    return res.status(202).json(enqueued);
  }),
);

opsRouter.patch(
  "/inbox/blocklist",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    await requireFeature(event.id, "ops_agent");
    const parsed = blocklistSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const updated = await prisma.event.update({
      where: { id: event.id },
      data: { communityBlocklist: parsed.data.communityBlocklist },
      select: { id: true, communityBlocklist: true },
    });
    return res.json(updated);
  }),
);

opsRouter.patch(
  "/inbox/:cardId",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    await requireFeature(event.id, "ops_agent");
    const parsed = editSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    try {
      const card = await editOpsCard({
        cardId: req.params.cardId,
        eventId: event.id,
        draftTitle: parsed.data.draftTitle,
        draftBody: parsed.data.draftBody,
        draftPayload: parsed.data.draftPayload,
      });
      return res.json(card);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 404) throw new HttpError(404, { error: "Open ops card not found" });
      throw err;
    }
  }),
);

opsRouter.post(
  "/inbox/:cardId/dismiss",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    await requireFeature(event.id, "ops_agent");
    try {
      const card = await dismissOpsCard({
        cardId: req.params.cardId,
        eventId: event.id,
        actorUserId: req.user!.id,
      });
      return res.json(card);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 404) throw new HttpError(404, { error: "Ops card not found" });
      throw err;
    }
  }),
);

/**
 * Explicit Send/Apply click only. Nothing in detectors/jobs calls applyOpsCard.
 */
opsRouter.post(
  "/inbox/:cardId/apply",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    await requireFeature(event.id, "ops_agent");

    const result = await applyOpsCard({
      cardId: req.params.cardId,
      eventId: event.id,
      actorUserId: req.user!.id,
    });
    return res.json(result);
  }),
);
