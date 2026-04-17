import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db";
import { getOrCreateEvent } from "../lib/event";
import { ensureUniqueEventSlug, slugifyEventBase } from "../lib/slug";
import { AuthedRequest, requireAuth, requireRole } from "../lib/middleware";

export const eventRouter = Router();

const slugField = z
  .string()
  .min(2)
  .max(72)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .optional();

const eventSchema = z.object({
  name: z.string().min(1),
  slug: slugField,
  bannerUrl: z.string().max(2_000_000).optional(),
  timezone: z.string().min(1),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
});

eventRouter.get("/slug/:slug", async (req, res) => {
  const raw = String(req.params.slug || "").trim().toLowerCase();
  if (!raw) {
    return res.status(400).json({ error: "Invalid slug" });
  }
  const event = await prisma.event.findUnique({
    where: { slug: raw },
    select: {
      id: true,
      name: true,
      slug: true,
      bannerUrl: true,
      timezone: true,
      startDate: true,
      endDate: true,
    },
  });
  if (!event) {
    return res.status(404).json({ error: "Event not found" });
  }
  return res.json(event);
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

  const slugBase = parsed.data.slug?.trim().toLowerCase() || slugifyEventBase(parsed.data.name);
  const slug = await ensureUniqueEventSlug(slugBase);
  const created = await prisma.event.create({
    data: {
      name: parsed.data.name,
      slug,
      bannerUrl: parsed.data.bannerUrl?.trim() || null,
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
  let slug = event.slug;
  if (parsed.data.slug !== undefined) {
    const next = parsed.data.slug.trim().toLowerCase();
    slug = await ensureUniqueEventSlug(next, event.id);
  }

  const updated = await prisma.event.update({
    where: { id: event.id },
    data: {
      name: parsed.data.name,
      slug,
      bannerUrl: parsed.data.bannerUrl?.trim() || null,
      timezone: parsed.data.timezone,
      startDate: new Date(parsed.data.startDate),
      endDate: new Date(parsed.data.endDate),
    },
  });

  return res.json(updated);
});
