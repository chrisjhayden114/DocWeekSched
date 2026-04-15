import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db";
import { getOrCreateSessionConversation } from "../lib/conversations";
import { getOrCreateEvent } from "../lib/event";
import { AuthedRequest, requireAuth, requireRole } from "../lib/middleware";

export const sessionsRouter = Router();

const sessionSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  speakers: z.string().optional(),
  zoomLink: z.union([z.string().url(), z.literal("")]).optional(),
  recordingUrl: z.union([z.string().url(), z.literal("")]).optional(),
  fileUrl: z.string().optional(),
  fileLink: z.union([z.string().url(), z.literal("")]).optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  speakerId: z.string().optional(),
});

const attendanceSchema = z.object({
  status: z.enum(["JOINING", "NOT_JOINING"]),
});

const messageSchema = z.object({
  body: z.string().min(1),
});

sessionsRouter.get("/", requireAuth, async (_req, res) => {
  const event = await getOrCreateEvent();
  const sessions = await prisma.session.findMany({
    where: { eventId: event.id },
    orderBy: { startsAt: "asc" },
    include: {
      speaker: { select: { id: true, name: true } },
      bookmarks: {
        select: {
          userId: true,
          user: { select: { id: true, name: true, email: true, photoUrl: true } },
        },
      },
      attendances: {
        select: {
          userId: true,
          status: true,
          user: { select: { id: true, name: true, email: true, photoUrl: true } },
        },
      },
      likes: {
        select: {
          userId: true,
          user: { select: { id: true, name: true, email: true, photoUrl: true } },
        },
      },
    },
  });
  return res.json(sessions);
});

sessionsRouter.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const saved = await prisma.sessionAttendance.findMany({
    where: { userId: req.user?.id || "" },
    select: { sessionId: true, status: true },
  });
  const likes = await prisma.sessionLike.findMany({
    where: { userId: req.user?.id || "" },
    select: { sessionId: true },
  });
  return res.json({ attendance: saved, likedSessionIds: likes.map((like) => like.sessionId) });
});

sessionsRouter.post("/", requireAuth, requireRole(["ADMIN"]), async (req, res) => {
  const parsed = sessionSchema.safeParse(req.body);
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
  const session = await prisma.session.create({
    data: {
      ...parsed.data,
      zoomLink: parsed.data.zoomLink || null,
      recordingUrl: parsed.data.recordingUrl || null,
      fileLink: parsed.data.fileLink || null,
      speakerId: parsed.data.speakerId || null,
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
      zoomLink: parsed.data.zoomLink || null,
      recordingUrl: parsed.data.recordingUrl || null,
      fileLink: parsed.data.fileLink || null,
      speakerId: parsed.data.speakerId || null,
      startsAt: new Date(parsed.data.startsAt),
      endsAt: new Date(parsed.data.endsAt),
    },
  });

  return res.json(session);
});

sessionsRouter.delete("/:id", requireAuth, requireRole(["ADMIN"]), async (req, res) => {
  await prisma.session.delete({ where: { id: req.params.id } });
  return res.json({ ok: true });
});

sessionsRouter.put("/:id/attendance", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = attendanceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  await prisma.sessionAttendance.upsert({
    where: {
      userId_sessionId: {
        userId: req.user?.id || "",
        sessionId: req.params.id,
      },
    },
    update: { status: parsed.data.status },
    create: {
      userId: req.user?.id || "",
      sessionId: req.params.id,
      status: parsed.data.status,
    },
  });

  return res.json({ ok: true });
});

sessionsRouter.put("/:id/like", requireAuth, async (req: AuthedRequest, res) => {
  await prisma.sessionLike.upsert({
    where: {
      userId_sessionId: {
        userId: req.user?.id || "",
        sessionId: req.params.id,
      },
    },
    update: {},
    create: {
      userId: req.user?.id || "",
      sessionId: req.params.id,
    },
  });
  return res.json({ ok: true });
});

sessionsRouter.delete("/:id/like", requireAuth, async (req: AuthedRequest, res) => {
  await prisma.sessionLike.deleteMany({
    where: {
      userId: req.user?.id || "",
      sessionId: req.params.id,
    },
  });
  return res.json({ ok: true });
});

sessionsRouter.get("/:id/conversation/messages", requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.user?.id || "";
  const conversation = await getOrCreateSessionConversation(req.params.id);

  await prisma.conversationMember.upsert({
    where: {
      conversationId_userId: {
        conversationId: conversation.id,
        userId,
      },
    },
    update: {},
    create: {
      conversationId: conversation.id,
      userId,
    },
  });

  const messages = await prisma.conversationMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { id: true, name: true, role: true, photoUrl: true } } },
  });

  return res.json(messages);
});

sessionsRouter.post("/:id/conversation/messages", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const userId = req.user?.id || "";
  const conversation = await getOrCreateSessionConversation(req.params.id);

  await prisma.conversationMember.upsert({
    where: {
      conversationId_userId: {
        conversationId: conversation.id,
        userId,
      },
    },
    update: {},
    create: {
      conversationId: conversation.id,
      userId,
    },
  });

  const message = await prisma.conversationMessage.create({
    data: {
      conversationId: conversation.id,
      userId,
      body: parsed.data.body,
    },
    include: { user: { select: { id: true, name: true, role: true, photoUrl: true } } },
  });

  return res.json(message);
});
