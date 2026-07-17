import { Router } from "express";
import { asyncHandler, HttpError, requireEventAccess } from "../lib/authorization";
import { prisma } from "../lib/db";
import { resolveEventFromRequest } from "../lib/requestEvent";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";

export const notificationsRouter = Router();

notificationsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const userId = req.user!.id;
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(userId, event.id);

    const items = await prisma.userNotification.findMany({
      where: { userId, eventId: event.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return res.json(items);
  }),
);

notificationsRouter.patch(
  "/:id/read",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const userId = req.user!.id;
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(userId, event.id);

    const updated = await prisma.userNotification.updateMany({
      where: { id: req.params.id, userId, eventId: event.id },
      data: { readAt: new Date() },
    });

    if (updated.count === 0) {
      throw new HttpError(404, { error: "Notification not found" });
    }

    return res.json({ ok: true });
  }),
);

notificationsRouter.post(
  "/read-all",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const userId = req.user!.id;
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(userId, event.id);

    await prisma.userNotification.updateMany({
      where: { userId, eventId: event.id, readAt: null },
      data: { readAt: new Date() },
    });

    return res.json({ ok: true });
  }),
);
