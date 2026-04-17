import { Router } from "express";
import { prisma } from "../lib/db";
import { resolveEventFromRequest } from "../lib/requestEvent";
import { AuthedRequest, requireAuth } from "../lib/middleware";

export const notificationsRouter = Router();

notificationsRouter.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.user?.id || "";
  const event = await resolveEventFromRequest(req);

  const items = await prisma.userNotification.findMany({
    where: { userId, eventId: event.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return res.json(items);
});

notificationsRouter.patch("/:id/read", requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.user?.id || "";
  const event = await resolveEventFromRequest(req);

  const updated = await prisma.userNotification.updateMany({
    where: { id: req.params.id, userId, eventId: event.id },
    data: { readAt: new Date() },
  });

  if (updated.count === 0) {
    return res.status(404).json({ error: "Notification not found" });
  }

  return res.json({ ok: true });
});

notificationsRouter.post("/read-all", requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.user?.id || "";
  const event = await resolveEventFromRequest(req);

  await prisma.userNotification.updateMany({
    where: { userId, eventId: event.id, readAt: null },
    data: { readAt: new Date() },
  });

  return res.json({ ok: true });
});
