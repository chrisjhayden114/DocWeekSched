import { Router } from "express";
import { z } from "zod";
import { asyncHandler, HttpError, requireEventAccess } from "../lib/authorization";
import { prisma } from "../lib/db";
import { requireFeature } from "../lib/features";
import { resolveEventFromRequest } from "../lib/requestEvent";
import { getStorageProvider } from "../lib/storage";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";
import { clampPercent } from "@event-app/shared";

export const mapsRouter = Router();

const mapSchema = z.object({
  name: z.string().min(1).max(120),
  imageUrl: z.string().min(1).max(5_000_000),
  sortOrder: z.number().int().optional(),
});

const mapUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  imageUrl: z.string().min(1).max(5_000_000).optional(),
  sortOrder: z.number().int().optional(),
});

const pinSchema = z.object({
  roomLabel: z.string().min(1).max(120),
  x: z.number(),
  y: z.number(),
  linkedRoomId: z.string().nullable().optional(),
});

const pinInclude = {
  linkedRoom: { select: { id: true, name: true } },
} as const;

async function assertVenueMapsRead(eventId: string, userId: string) {
  await requireEventAccess(userId, eventId);
  await requireFeature(eventId, "venue_maps");
}

async function loadMapForEvent(mapId: string, eventId: string) {
  return prisma.venueMap.findFirst({ where: { id: mapId, eventId } });
}

mapsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await assertVenueMapsRead(event.id, req.user!.id);
    const maps = await prisma.venueMap.findMany({
      where: { eventId: event.id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: {
        pins: {
          orderBy: { createdAt: "asc" },
          include: pinInclude,
        },
      },
    });
    return res.json(maps);
  }),
);

/** Resolve map + pin for a room (View on map). */
mapsRouter.get(
  "/by-room/:roomId",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await assertVenueMapsRead(event.id, req.user!.id);
    const pin = await prisma.mapPin.findFirst({
      where: {
        linkedRoomId: req.params.roomId,
        map: { eventId: event.id },
      },
      include: {
        map: true,
        linkedRoom: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    if (!pin) return res.status(404).json({ error: "No map pin for this room" });
    return res.json(pin);
  }),
);

mapsRouter.post(
  "/",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = mapSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });

    let imageUrl = parsed.data.imageUrl.trim();
    try {
      const stored = await getStorageProvider().acceptUpload({
        url: imageUrl,
        keyPrefix: `events/${event.id}/maps`,
        maxBytes: Number(process.env.STORAGE_MAX_UPLOAD_BYTES || 8_000_000),
        allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
      });
      imageUrl = stored.url;
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : "Upload failed" });
    }

    const map = await prisma.venueMap.create({
      data: {
        eventId: event.id,
        name: parsed.data.name.trim(),
        imageUrl,
        sortOrder: parsed.data.sortOrder ?? 0,
      },
      include: { pins: { include: pinInclude } },
    });
    return res.status(201).json(map);
  }),
);

mapsRouter.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await assertVenueMapsRead(event.id, req.user!.id);
    const map = await prisma.venueMap.findFirst({
      where: { id: req.params.id, eventId: event.id },
      include: { pins: { orderBy: { createdAt: "asc" }, include: pinInclude } },
    });
    if (!map) throw new HttpError(404, { error: "Map not found" });

    // Today's sessions per linked room (event timezone day bounds approximated via UTC day of event "now")
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setUTCHours(23, 59, 59, 999);
    const roomIds = map.pins.map((p) => p.linkedRoomId).filter(Boolean) as string[];
    const sessionsToday =
      roomIds.length === 0
        ? []
        : await prisma.session.findMany({
            where: {
              eventId: event.id,
              roomId: { in: roomIds },
              startsAt: { gte: startOfDay, lte: endOfDay },
            },
            select: {
              id: true,
              title: true,
              startsAt: true,
              endsAt: true,
              roomId: true,
            },
            orderBy: { startsAt: "asc" },
          });

    return res.json({ ...map, sessionsToday });
  }),
);

mapsRouter.put(
  "/:id",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = mapUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    const existing = await loadMapForEvent(req.params.id, event.id);
    if (!existing) throw new HttpError(404, { error: "Map not found" });

    let imageUrl = parsed.data.imageUrl;
    if (imageUrl !== undefined) {
      try {
        const stored = await getStorageProvider().acceptUpload({
          url: imageUrl.trim(),
          keyPrefix: `events/${event.id}/maps`,
          maxBytes: Number(process.env.STORAGE_MAX_UPLOAD_BYTES || 8_000_000),
          allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
        });
        imageUrl = stored.url;
      } catch (err) {
        return res.status(400).json({ error: err instanceof Error ? err.message : "Upload failed" });
      }
    }

    const updated = await prisma.venueMap.update({
      where: { id: existing.id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
        ...(imageUrl !== undefined ? { imageUrl } : {}),
        ...(parsed.data.sortOrder !== undefined ? { sortOrder: parsed.data.sortOrder } : {}),
      },
      include: { pins: { orderBy: { createdAt: "asc" }, include: pinInclude } },
    });
    return res.json(updated);
  }),
);

mapsRouter.delete(
  "/:id",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    const existing = await loadMapForEvent(req.params.id, event.id);
    if (!existing) throw new HttpError(404, { error: "Map not found" });
    await prisma.venueMap.delete({ where: { id: existing.id } });
    return res.json({ ok: true });
  }),
);

mapsRouter.get(
  "/:id/pins",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await assertVenueMapsRead(event.id, req.user!.id);
    const map = await loadMapForEvent(req.params.id, event.id);
    if (!map) throw new HttpError(404, { error: "Map not found" });
    const pins = await prisma.mapPin.findMany({
      where: { mapId: map.id },
      orderBy: { createdAt: "asc" },
      include: pinInclude,
    });
    return res.json(pins);
  }),
);

mapsRouter.post(
  "/:id/pins",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = pinSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    const map = await loadMapForEvent(req.params.id, event.id);
    if (!map) throw new HttpError(404, { error: "Map not found" });

    if (parsed.data.linkedRoomId) {
      const room = await prisma.room.findFirst({
        where: { id: parsed.data.linkedRoomId, eventId: event.id },
      });
      if (!room) return res.status(400).json({ error: "linkedRoomId is not a room on this event" });
    }

    const pin = await prisma.mapPin.create({
      data: {
        mapId: map.id,
        roomLabel: parsed.data.roomLabel.trim(),
        x: clampPercent(parsed.data.x),
        y: clampPercent(parsed.data.y),
        linkedRoomId: parsed.data.linkedRoomId ?? null,
      },
      include: pinInclude,
    });
    return res.status(201).json(pin);
  }),
);

mapsRouter.put(
  "/:id/pins/:pinId",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = pinSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    const map = await loadMapForEvent(req.params.id, event.id);
    if (!map) throw new HttpError(404, { error: "Map not found" });
    const existing = await prisma.mapPin.findFirst({
      where: { id: req.params.pinId, mapId: map.id },
    });
    if (!existing) throw new HttpError(404, { error: "Pin not found" });

    if (parsed.data.linkedRoomId) {
      const room = await prisma.room.findFirst({
        where: { id: parsed.data.linkedRoomId, eventId: event.id },
      });
      if (!room) return res.status(400).json({ error: "linkedRoomId is not a room on this event" });
    }

    const updated = await prisma.mapPin.update({
      where: { id: existing.id },
      data: {
        ...(parsed.data.roomLabel !== undefined ? { roomLabel: parsed.data.roomLabel.trim() } : {}),
        ...(parsed.data.x !== undefined ? { x: clampPercent(parsed.data.x) } : {}),
        ...(parsed.data.y !== undefined ? { y: clampPercent(parsed.data.y) } : {}),
        ...(parsed.data.linkedRoomId !== undefined ? { linkedRoomId: parsed.data.linkedRoomId } : {}),
      },
      include: pinInclude,
    });
    return res.json(updated);
  }),
);

mapsRouter.delete(
  "/:id/pins/:pinId",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    const map = await loadMapForEvent(req.params.id, event.id);
    if (!map) throw new HttpError(404, { error: "Map not found" });
    const existing = await prisma.mapPin.findFirst({
      where: { id: req.params.pinId, mapId: map.id },
    });
    if (!existing) throw new HttpError(404, { error: "Pin not found" });
    await prisma.mapPin.delete({ where: { id: existing.id } });
    return res.json({ ok: true });
  }),
);
