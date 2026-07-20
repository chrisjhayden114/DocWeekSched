import { Router } from "express";
import { asyncHandler, HttpError, requireEventAccess } from "../lib/authorization";
import { prisma } from "../lib/db";
import { resolveEventFromRequest } from "../lib/requestEvent";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";
import { parsePagination, setPageHeaders, slicePage } from "../lib/pagination";

export const notificationsRouter = Router();

notificationsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const userId = req.user!.id;
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(userId, event.id);
    const { take, cursor } = parsePagination(req.query);

    const items = await prisma.userNotification.findMany({
      where: { userId, eventId: event.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: take + 1,
    });

    const page = slicePage(items, take);
    setPageHeaders(res, page);
    return res.json(page.items);
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
