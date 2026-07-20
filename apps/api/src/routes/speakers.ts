import { Router } from "express";
import { z } from "zod";
import { asyncHandler, requireEventAccess } from "../lib/authorization";
import { prisma } from "../lib/db";
import { getStorageProvider } from "../lib/storage";
import { resolveEventFromRequest } from "../lib/requestEvent";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";
import { validationErrorBody } from "../lib/errors";

export const speakersRouter = Router();

const speakerSchema = z.object({
  name: z.string().min(1).max(200),
  title: z.string().max(200).optional().nullable(),
  affiliation: z.string().max(200).optional().nullable(),
  bio: z.string().max(8000).optional().nullable(),
  photoUrl: z.string().max(12_000_000).optional().nullable(),
  sortOrder: z.number().int().optional(),
});

speakersRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id);
    const speakers = await prisma.speaker.findMany({
      where: { eventId: event.id },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        sessions: { select: { sessionId: true, sortOrder: true } },
      },
    });
    return res.json(speakers);
  }),
);

speakersRouter.post(
  "/",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = speakerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationErrorBody(parsed.error));
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });

    let photoUrl = parsed.data.photoUrl?.trim() || null;
    let storageKey: string | null = null;
    if (photoUrl?.startsWith("data:")) {
      const stored = await getStorageProvider().acceptUpload({
        url: photoUrl,
        keyPrefix: `events/${event.id}/speakers`,
        maxBytes: Number(process.env.STORAGE_MAX_UPLOAD_BYTES || 4_500_000),
        allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
      });
      photoUrl = stored.url;
      storageKey = stored.storageKey;
    }

    const speaker = await prisma.speaker.create({
      data: {
        eventId: event.id,
        name: parsed.data.name.trim(),
        title: parsed.data.title?.trim() || null,
        affiliation: parsed.data.affiliation?.trim() || null,
        bio: parsed.data.bio?.trim() || null,
        photoUrl,
        sortOrder: parsed.data.sortOrder ?? 0,
      },
    });
    return res.status(201).json({ ...speaker, storageKey });
  }),
);

speakersRouter.put(
  "/:id",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = speakerSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationErrorBody(parsed.error));
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    const existing = await prisma.speaker.findFirst({ where: { id: req.params.id, eventId: event.id } });
    if (!existing) return res.status(404).json({ error: "Speaker not found" });

    let photoUrl = parsed.data.photoUrl;
    if (typeof photoUrl === "string" && photoUrl.startsWith("data:")) {
      const stored = await getStorageProvider().acceptUpload({
        url: photoUrl,
        keyPrefix: `events/${event.id}/speakers`,
        maxBytes: Number(process.env.STORAGE_MAX_UPLOAD_BYTES || 4_500_000),
        allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
      });
      photoUrl = stored.url;
    }

    const updated = await prisma.speaker.update({
      where: { id: existing.id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
        ...(parsed.data.title !== undefined ? { title: parsed.data.title?.trim() || null } : {}),
        ...(parsed.data.affiliation !== undefined
          ? { affiliation: parsed.data.affiliation?.trim() || null }
          : {}),
        ...(parsed.data.bio !== undefined ? { bio: parsed.data.bio?.trim() || null } : {}),
        ...(photoUrl !== undefined ? { photoUrl: photoUrl?.trim() || null } : {}),
        ...(parsed.data.sortOrder !== undefined ? { sortOrder: parsed.data.sortOrder } : {}),
      },
    });
    return res.json(updated);
  }),
);

speakersRouter.delete(
  "/:id",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    const existing = await prisma.speaker.findFirst({ where: { id: req.params.id, eventId: event.id } });
    if (!existing) return res.status(404).json({ error: "Speaker not found" });
    await prisma.speaker.delete({ where: { id: existing.id } });
    return res.json({ ok: true });
  }),
);
