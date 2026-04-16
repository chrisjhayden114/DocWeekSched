import { Router } from "express";
import { prisma } from "../lib/db";
import { resolveEventFromRequest } from "../lib/requestEvent";
import { requireAuth, requireRole, AuthedRequest } from "../lib/middleware";

export const checkinRouter = Router();

checkinRouter.post("/", requireAuth, async (req: AuthedRequest, res) => {
  const event = await resolveEventFromRequest(req);
  const checkIn = await prisma.checkIn.upsert({
    where: { userId_eventId: { userId: req.user?.id || "", eventId: event.id } },
    update: {},
    create: { userId: req.user?.id || "", eventId: event.id },
  });

  return res.json(checkIn);
});

checkinRouter.post("/:userId", requireAuth, requireRole(["ADMIN"]), async (req, res) => {
  const event = await resolveEventFromRequest(req);
  const checkIn = await prisma.checkIn.upsert({
    where: { userId_eventId: { userId: req.params.userId, eventId: event.id } },
    update: {},
    create: { userId: req.params.userId, eventId: event.id },
  });

  return res.json(checkIn);
});

checkinRouter.get("/", requireAuth, requireRole(["ADMIN"]), async (req, res) => {
  const event = await resolveEventFromRequest(req);
  const checkIns = await prisma.checkIn.findMany({
    where: { eventId: event.id },
    include: { user: { select: { id: true, name: true, email: true, role: true } } },
  });

  return res.json(checkIns);
});
