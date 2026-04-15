import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db";
import { getOrCreateEvent } from "../lib/event";
import { AuthedRequest, requireAuth, requireRole } from "../lib/middleware";

export const eventRouter = Router();

const eventSchema = z.object({
  name: z.string().min(1),
  bannerUrl: z.union([z.string().url(), z.literal("")]).optional(),
  timezone: z.string().min(1),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
});

eventRouter.get("/", requireAuth, async (req, res) => {
  const requestedEventId = typeof req.headers["x-event-id"] === "string" ? req.headers["x-event-id"] : undefined;
  const event = requestedEventId
    ? await prisma.event.findUnique({ where: { id: requestedEventId } })
    : await getOrCreateEvent();
  if (!event) {
    return res.status(404).json({ error: "Event not found" });
  }
  return res.json(event);
});

eventRouter.get("/mine", requireAuth, requireRole(["ADMIN"]), async (req: AuthedRequest, res) => {
  const events = await prisma.event.findMany({
    where: { createdById: req.user?.id || "" },
    orderBy: { startDate: "desc" },
  });
  return res.json(events);
});

eventRouter.post("/", requireAuth, requireRole(["ADMIN"]), async (req: AuthedRequest, res) => {
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const created = await prisma.event.create({
    data: {
      name: parsed.data.name,
      bannerUrl: parsed.data.bannerUrl || null,
      timezone: parsed.data.timezone,
      startDate: new Date(parsed.data.startDate),
      endDate: new Date(parsed.data.endDate),
      createdById: req.user?.id || undefined,
    },
  });

  return res.json(created);
});

eventRouter.put("/", requireAuth, requireRole(["ADMIN"]), async (req, res) => {
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const requestedEventId = typeof req.headers["x-event-id"] === "string" ? req.headers["x-event-id"] : undefined;
  const event = requestedEventId
    ? await prisma.event.findUnique({ where: { id: requestedEventId } })
    : await getOrCreateEvent();
  if (!event) {
    return res.status(404).json({ error: "Event not found" });
  }
  const updated = await prisma.event.update({
    where: { id: event.id },
    data: {
      name: parsed.data.name,
      bannerUrl: parsed.data.bannerUrl || null,
      timezone: parsed.data.timezone,
      startDate: new Date(parsed.data.startDate),
      endDate: new Date(parsed.data.endDate),
    },
  });

  return res.json(updated);
});
