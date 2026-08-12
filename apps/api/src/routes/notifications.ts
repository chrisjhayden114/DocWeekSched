import { Router } from "express";
import { z } from "zod";
import { asyncHandler, HttpError, requireEventAccess } from "../lib/authorization";
import { prisma } from "../lib/db";
import { resolveEventFromRequest } from "../lib/requestEvent";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";
import { parsePagination, setPageHeaders, slicePage } from "../lib/pagination";
import { validationErrorBody } from "../lib/errors";
import { DEFAULT_PREFS } from "../lib/notifications/types";

export const notificationsRouter = Router();

const notificationPrefsSchema = z.object({
  quietHoursStart: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
  quietHoursEnd: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
  digestLocalTime: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
  digestEmail: z.boolean().optional(),
  messageEmail: z.boolean().optional(),
  readReceipts: z.boolean().optional(),
  mutedCategories: z.array(z.string()).optional(),
  timezone: z.string().nullable().optional(),
});

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

function resolvedPrefs(
  row: {
    quietHoursStart: string;
    quietHoursEnd: string;
    digestLocalTime: string;
    digestEmail: boolean;
    messageEmail?: boolean;
    readReceipts?: boolean;
    mutedCategories: string[];
    timezone: string | null;
  } | null,
  eventTimezone: string,
) {
  return {
    quietHoursStart: row?.quietHoursStart ?? DEFAULT_PREFS.quietHoursStart,
    quietHoursEnd: row?.quietHoursEnd ?? DEFAULT_PREFS.quietHoursEnd,
    digestLocalTime: row?.digestLocalTime ?? DEFAULT_PREFS.digestLocalTime,
    digestEmail: row?.digestEmail ?? DEFAULT_PREFS.digestEmail,
    messageEmail: row?.messageEmail ?? true,
    readReceipts: row?.readReceipts ?? false,
    mutedCategories: row?.mutedCategories ?? DEFAULT_PREFS.mutedCategories,
    timezone: row?.timezone || eventTimezone || "UTC",
  };
}

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
    const data = {
      ...(parsed.data.quietHoursStart !== undefined ? { quietHoursStart: parsed.data.quietHoursStart } : {}),
      ...(parsed.data.quietHoursEnd !== undefined ? { quietHoursEnd: parsed.data.quietHoursEnd } : {}),
      ...(parsed.data.digestLocalTime !== undefined ? { digestLocalTime: parsed.data.digestLocalTime } : {}),
      ...(parsed.data.digestEmail !== undefined ? { digestEmail: parsed.data.digestEmail } : {}),
      ...(parsed.data.messageEmail !== undefined ? { messageEmail: parsed.data.messageEmail } : {}),
      ...(parsed.data.readReceipts !== undefined ? { readReceipts: parsed.data.readReceipts } : {}),
      ...(parsed.data.mutedCategories !== undefined ? { mutedCategories: parsed.data.mutedCategories } : {}),
      ...(parsed.data.timezone !== undefined ? { timezone: parsed.data.timezone } : {}),
    };
    const row = existing
      ? await prisma.notificationPreference.update({ where: { id: existing.id }, data })
      : await prisma.notificationPreference.create({
          data: { userId, eventId: event.id, ...data },
        });
    return res.json(resolvedPrefs(row, event.timezone));
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
