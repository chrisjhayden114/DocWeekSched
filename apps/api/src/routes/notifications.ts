import { Router } from "express";
import { asyncHandler, HttpError, requireEventAccess } from "../lib/authorization";
import { prisma } from "../lib/db";
import { resolveEventFromRequest } from "../lib/requestEvent";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";
import { parsePagination, setPageHeaders, slicePage } from "../lib/pagination";
import { validationErrorBody } from "../lib/errors";
import {
  getAccountNotificationPreference,
  notificationPrefsSchema,
  preferenceWriteData,
  resolvedPrefs,
  upsertAccountNotificationPreference,
} from "../lib/notifications/accountPrefs";

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

notificationsRouter.get(
  "/preferences",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const userId = req.user!.id;
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(userId, event.id);
    const [eventPref, globalPref] = await Promise.all([
      prisma.notificationPreference.findFirst({ where: { userId, eventId: event.id } }),
      prisma.notificationPreference.findFirst({ where: { userId, eventId: null } }),
    ]);
    return res.json(resolvedPrefs(eventPref || globalPref, event.timezone));
  }),
);

notificationsRouter.put(
  "/preferences",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = notificationPrefsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationErrorBody(parsed.error));
    const userId = req.user!.id;
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(userId, event.id);

    const existing = await prisma.notificationPreference.findFirst({
      where: { userId, eventId: event.id },
    });
    const data = preferenceWriteData(parsed.data);
    const row = existing
      ? await prisma.notificationPreference.update({ where: { id: existing.id }, data })
      : await prisma.notificationPreference.create({
          data: { userId, eventId: event.id, ...data },
        });
    return res.json(resolvedPrefs(row, event.timezone));
  }),
);

/** Account-level defaults: the eventId-null row. GET /preferences already falls back to it. */
notificationsRouter.get(
  "/preferences/account",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    return res.json(await getAccountNotificationPreference(req.user!.id));
  }),
);

notificationsRouter.put(
  "/preferences/account",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = notificationPrefsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationErrorBody(parsed.error));
    return res.json(await upsertAccountNotificationPreference(req.user!.id, parsed.data));
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
