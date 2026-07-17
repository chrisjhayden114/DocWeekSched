import { Router } from "express";
import { z } from "zod";
import { asyncHandler, requireEventAccess } from "../lib/authorization";
import { prisma } from "../lib/db";
import { resolveEventFromRequest } from "../lib/requestEvent";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";

export const tracksRouter = Router();

const trackSchema = z.object({
  name: z.string().min(1).max(120),
  color: z.string().min(1).max(32),
  sortOrder: z.number().int().optional(),
});

tracksRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id);
    const tracks = await prisma.track.findMany({
      where: { eventId: event.id },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return res.json(tracks);
  }),
);

tracksRouter.post(
  "/",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = trackSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    const track = await prisma.track.create({
      data: {
        eventId: event.id,
        name: parsed.data.name.trim(),
        color: parsed.data.color.trim(),
        sortOrder: parsed.data.sortOrder ?? 0,
      },
    });
    return res.status(201).json(track);
  }),
);

tracksRouter.put(
  "/:id",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = trackSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    const existing = await prisma.track.findFirst({ where: { id: req.params.id, eventId: event.id } });
    if (!existing) return res.status(404).json({ error: "Track not found" });
    const updated = await prisma.track.update({
      where: { id: existing.id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
        ...(parsed.data.color !== undefined ? { color: parsed.data.color.trim() } : {}),
        ...(parsed.data.sortOrder !== undefined ? { sortOrder: parsed.data.sortOrder } : {}),
      },
    });
    return res.json(updated);
  }),
);

tracksRouter.delete(
  "/:id",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    const existing = await prisma.track.findFirst({ where: { id: req.params.id, eventId: event.id } });
    if (!existing) return res.status(404).json({ error: "Track not found" });
    await prisma.track.delete({ where: { id: existing.id } });
    return res.json({ ok: true });
  }),
);
