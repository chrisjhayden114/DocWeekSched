import { Router } from "express";
import { z } from "zod";
import { asyncHandler, requireEventAccess } from "../lib/authorization";
import { prisma } from "../lib/db";
import { resolveEventFromRequest } from "../lib/requestEvent";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";

export const roomsRouter = Router();

const roomSchema = z.object({
  name: z.string().min(1).max(120),
  sortOrder: z.number().int().optional(),
});

roomsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id);
    const rooms = await prisma.room.findMany({
      where: { eventId: event.id },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return res.json(rooms);
  }),
);

roomsRouter.post(
  "/",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = roomSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    const room = await prisma.room.create({
      data: {
        eventId: event.id,
        name: parsed.data.name.trim(),
        sortOrder: parsed.data.sortOrder ?? 0,
      },
    });
    return res.status(201).json(room);
  }),
);

roomsRouter.put(
  "/:id",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = roomSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    const existing = await prisma.room.findFirst({ where: { id: req.params.id, eventId: event.id } });
    if (!existing) return res.status(404).json({ error: "Room not found" });
    const updated = await prisma.room.update({
      where: { id: existing.id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
        ...(parsed.data.sortOrder !== undefined ? { sortOrder: parsed.data.sortOrder } : {}),
      },
    });
    return res.json(updated);
  }),
);

roomsRouter.delete(
  "/:id",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    const existing = await prisma.room.findFirst({ where: { id: req.params.id, eventId: event.id } });
    if (!existing) return res.status(404).json({ error: "Room not found" });
    await prisma.room.delete({ where: { id: existing.id } });
    return res.json({ ok: true });
  }),
);
