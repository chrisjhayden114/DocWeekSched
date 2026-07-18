import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/authorization";
import { prisma } from "../lib/db";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";
import { vapidPublicKey } from "../lib/push/webPush";

export const pushRouter = Router();

pushRouter.get(
  "/vapid-public-key",
  requireAuth,
  asyncHandler(async (_req: AuthedRequest, res) => {
    return res.json({ publicKey: vapidPublicKey() });
  }),
);

const subscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }),
  userAgent: z.string().max(300).optional(),
});

pushRouter.post(
  "/subscribe",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = subscribeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const userId = req.user!.id;
    const row = await prisma.pushSubscription.upsert({
      where: { endpoint: parsed.data.endpoint },
      create: {
        userId,
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        userAgent: parsed.data.userAgent || null,
        lastSeenAt: new Date(),
      },
      update: {
        userId,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        userAgent: parsed.data.userAgent || null,
        lastSeenAt: new Date(),
      },
    });
    return res.status(201).json({ id: row.id });
  }),
);

pushRouter.delete(
  "/subscribe",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint : null;
    if (!endpoint) return res.status(400).json({ error: "endpoint required" });
    await prisma.pushSubscription.deleteMany({
      where: { userId: req.user!.id, endpoint },
    });
    return res.json({ ok: true });
  }),
);
