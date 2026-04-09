import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db";
import { getOrCreateEvent } from "../lib/event";
import { requireAuth, requireRole } from "../lib/middleware";

export const sessionsRouter = Router();

const sessionSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  speakerId: z.string().optional(),
});

sessionsRouter.get("/", requireAuth, async (_req, res) => {
  const event = await getOrCreateEvent();
  const sessions = await prisma.session.findMany({
    where: { eventId: event.id },
    orderBy: { startsAt: "asc" },
    include: { speaker: { select: { id: true, name: true } } },
  });
  return res.json(sessions);
});

sessionsRouter.post("/", requireAuth, requireRole(["ADMIN"]), async (req, res) => {
  const parsed = sessionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const event = await getOrCreateEvent();
  const session = await prisma.session.create({
    data: {
      ...parsed.data,
      startsAt: new Date(parsed.data.startsAt),
      endsAt: new Date(parsed.data.endsAt),
      eventId: event.id,
    },
  });
  return res.json(session);
});

sessionsRouter.put("/:id", requireAuth, requireRole(["ADMIN"]), async (req, res) => {
  const parsed = sessionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const session = await prisma.session.update({
    where: { id: req.params.id },
    data: {
      ...parsed.data,
      startsAt: new Date(parsed.data.startsAt),
      endsAt: new Date(parsed.data.endsAt),
    },
  });

  return res.json(session);
});
