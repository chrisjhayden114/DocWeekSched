import { Router } from "express";
import { asyncHandler, HttpError, requireEventAccess } from "../lib/authorization";
import { prisma } from "../lib/db";
import { resolveEventFromRequest } from "../lib/requestEvent";
import { requireAuth, requireCsrf, AuthedRequest } from "../lib/middleware";

export const checkinRouter = Router();

checkinRouter.post(
  "/",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id);

    const checkIn = await prisma.checkIn.upsert({
      where: { userId_eventId: { userId: req.user!.id, eventId: event.id } },
      update: {},
      create: { userId: req.user!.id, eventId: event.id },
    });

    return res.json(checkIn);
  }),
);

checkinRouter.post(
  "/:userId",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });

    const targetMembership = await prisma.eventMembership.findUnique({
      where: { eventId_userId: { eventId: event.id, userId: req.params.userId } },
    });
    if (!targetMembership) {
      throw new HttpError(404, { error: "Participant not found" });
    }

    const checkIn = await prisma.checkIn.upsert({
      where: { userId_eventId: { userId: req.params.userId, eventId: event.id } },
      update: {},
      create: { userId: req.params.userId, eventId: event.id },
    });

    return res.json(checkIn);
  }),
);

checkinRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });

    const checkIns = await prisma.checkIn.findMany({
      where: { eventId: event.id },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
    });

    return res.json(checkIns);
  }),
);
