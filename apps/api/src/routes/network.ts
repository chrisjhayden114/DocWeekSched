import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db";
import { awardEngagementPoints, POINTS } from "../lib/points";
import { resolveEventFromRequest } from "../lib/requestEvent";
import { AuthedRequest, requireAuth, requireRole } from "../lib/middleware";

export const networkRouter = Router();

const threadSchema = z.object({
  title: z.string().min(1).max(500),
  body: z.string().min(1).max(8000),
});

const replySchema = z.object({
  body: z.string().min(1).max(8000),
});

networkRouter.get("/threads", requireAuth, async (req, res) => {
  const event = await resolveEventFromRequest(req);
  const threads = await prisma.networkThread.findMany({
    where: { eventId: event.id },
    orderBy: { createdAt: "desc" },
    include: {
      author: { select: { id: true, name: true, role: true, photoUrl: true } },
      replies: {
        orderBy: { createdAt: "asc" },
        include: { author: { select: { id: true, name: true, role: true, photoUrl: true } } },
      },
    },
  });
  return res.json(threads);
});

networkRouter.post("/threads", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = threadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const event = await resolveEventFromRequest(req);
  const userId = req.user?.id || "";
  const thread = await prisma.networkThread.create({
    data: {
      eventId: event.id,
      authorId: userId,
      title: parsed.data.title,
      body: parsed.data.body,
    },
    include: {
      author: { select: { id: true, name: true, role: true, photoUrl: true } },
      replies: {
        include: { author: { select: { id: true, name: true, role: true, photoUrl: true } } },
      },
    },
  });

  await awardEngagementPoints(userId, POINTS.NETWORK_THREAD);
  return res.json(thread);
});

networkRouter.post("/threads/:id/replies", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = replySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const event = await resolveEventFromRequest(req);
  const thread = await prisma.networkThread.findFirst({
    where: { id: req.params.id, eventId: event.id },
  });
  if (!thread) {
    return res.status(404).json({ error: "Thread not found" });
  }

  const userId = req.user?.id || "";
  const reply = await prisma.networkReply.create({
    data: {
      threadId: thread.id,
      authorId: userId,
      body: parsed.data.body,
    },
    include: { author: { select: { id: true, name: true, role: true, photoUrl: true } } },
  });

  await awardEngagementPoints(userId, POINTS.NETWORK_REPLY);
  return res.json(reply);
});

networkRouter.delete("/threads/:id", requireAuth, requireRole(["ADMIN"]), async (req, res) => {
  const event = await resolveEventFromRequest(req);
  const thread = await prisma.networkThread.findFirst({
    where: { id: req.params.id, eventId: event.id },
  });
  if (!thread) {
    return res.status(404).json({ error: "Thread not found" });
  }

  await prisma.networkThread.delete({ where: { id: thread.id } });
  return res.json({ ok: true });
});
