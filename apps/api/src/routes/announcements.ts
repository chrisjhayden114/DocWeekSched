import { Router } from "express";
import { z } from "zod";
import { asyncHandler, requireEventAccess } from "../lib/authorization";
import { prisma } from "../lib/db";
import { resolveEventFromRequest } from "../lib/requestEvent";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";

export const announcementsRouter = Router();

const announcementSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
});

announcementsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id);

    const announcements = await prisma.announcement.findMany({
      where: { eventId: event.id },
      orderBy: { createdAt: "desc" },
    });
    return res.json(announcements);
  }),
);

announcementsRouter.post(
  "/",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = announcementSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });

    const announcement = await prisma.announcement.create({
      data: { ...parsed.data, eventId: event.id },
    });

    return res.json(announcement);
  }),
);
