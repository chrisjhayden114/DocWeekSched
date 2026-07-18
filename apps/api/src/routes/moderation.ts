import { Router } from "express";
import { z } from "zod";
import { ModerationReportStatus, NotificationKind } from "@prisma/client";
import { asyncHandler, HttpError, requireEventAccess } from "../lib/authorization";
import { prisma } from "../lib/db";
import { resolveEventFromRequest } from "../lib/requestEvent";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";
import { notifyMany } from "../lib/notifications";

export const moderationRouter = Router();

moderationRouter.post(
  "/block",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = z.object({ userId: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const event = await resolveEventFromRequest(req);
    const blockerId = req.user!.id;
    const blockedId = parsed.data.userId;
    await requireEventAccess(blockerId, event.id);
    if (blockerId === blockedId) throw new HttpError(400, { error: "Cannot block yourself" });

    const row = await prisma.userBlock.upsert({
      where: {
        blockerId_blockedId_eventId: { blockerId, blockedId, eventId: event.id },
      },
      create: { blockerId, blockedId, eventId: event.id },
      update: {},
    });
    return res.status(201).json(row);
  }),
);

moderationRouter.delete(
  "/block/:userId",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id);
    await prisma.userBlock.deleteMany({
      where: { eventId: event.id, blockerId: req.user!.id, blockedId: req.params.userId },
    });
    return res.json({ ok: true });
  }),
);

moderationRouter.post(
  "/report",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = z
      .object({
        userId: z.string().min(1),
        reason: z.string().min(1).max(200),
        details: z.string().max(2000).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const event = await resolveEventFromRequest(req);
    const reporterId = req.user!.id;
    await requireEventAccess(reporterId, event.id);

    const report = await prisma.userReport.create({
      data: {
        eventId: event.id,
        reporterId,
        reportedUserId: parsed.data.userId,
        reason: parsed.data.reason.trim(),
        details: parsed.data.details?.trim() || null,
      },
    });

    const admins = await prisma.eventMembership.findMany({
      where: { eventId: event.id, deletedAt: null, role: "ADMIN" },
      select: { userId: true },
    });
    await notifyMany(
      admins
        .filter((a) => a.userId !== reporterId)
        .map((a) => ({
          userId: a.userId,
          eventId: event.id,
          kind: NotificationKind.USER_REPORT,
          title: "Attendee report filed",
          body: parsed.data.reason.slice(0, 180),
        })),
    );

    return res.status(201).json(report);
  }),
);

moderationRouter.get(
  "/reports",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    const reports = await prisma.userReport.findMany({
      where: { eventId: event.id },
      include: {
        reporter: { select: { id: true, name: true, email: true } },
        reportedUser: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return res.json(reports);
  }),
);

moderationRouter.post(
  "/reports/:id/resolve",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = z
      .object({ status: z.enum(["REVIEWED", "DISMISSED"]) })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    const updated = await prisma.userReport.updateMany({
      where: { id: req.params.id, eventId: event.id },
      data: {
        status: parsed.data.status as ModerationReportStatus,
        resolvedAt: new Date(),
        resolverId: req.user!.id,
      },
    });
    if (updated.count === 0) throw new HttpError(404, { error: "Report not found" });
    return res.json({ ok: true });
  }),
);
