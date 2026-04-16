import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db";
import { getOrCreateSessionConversation } from "../lib/conversations";
import { getOrCreateEvent } from "../lib/event";
import { awardEngagementPoints, POINTS } from "../lib/points";
import { AuthedRequest, requireAuth, requireRole } from "../lib/middleware";

export const sessionsRouter = Router();

const optionalLink = z.string().max(5_000_000).optional();

const sessionSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  speakers: z.string().optional(),
  imageUrl: optionalLink,
  zoomLink: optionalLink,
  recordingUrl: optionalLink,
  fileUrl: optionalLink,
  fileLink: optionalLink,
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  speakerId: z.string().optional(),
});

const attendanceSchema = z.object({
  status: z.enum(["JOINING", "NOT_JOINING"]),
  joinMode: z.enum(["VIRTUAL", "IN_PERSON"]).optional(),
});

const messageSchema = z.object({
  body: z.string().min(1),
});

async function findSessionOr404(sessionId: string) {
  const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { id: true } });
  return session;
}

sessionsRouter.get("/", requireAuth, async (req, res) => {
  const requestedEventId = typeof req.headers["x-event-id"] === "string" ? req.headers["x-event-id"] : undefined;
  const event = requestedEventId
    ? await prisma.event.findUnique({ where: { id: requestedEventId } })
    : await getOrCreateEvent();
  if (!event) {
    return res.status(404).json({ error: "Event not found" });
  }
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
          joinMode: true,
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
    select: { sessionId: true, status: true, joinMode: true },
  });
  const likes = await prisma.sessionLike.findMany({
    where: { userId: req.user?.id || "" },
    select: { sessionId: true },
  });
  return res.json({ attendance: saved, likedSessionIds: likes.map((like) => like.sessionId) });
});

sessionsRouter.get("/:id", requireAuth, async (req, res) => {
  const requestedEventId = typeof req.headers["x-event-id"] === "string" ? req.headers["x-event-id"] : undefined;
  const event = requestedEventId
    ? await prisma.event.findUnique({ where: { id: requestedEventId } })
    : await getOrCreateEvent();
  if (!event) {
    return res.status(404).json({ error: "Event not found" });
  }

  const session = await prisma.session.findFirst({
    where: { id: req.params.id, eventId: event.id },
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
          joinMode: true,
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

  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  return res.json(session);
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
      title: parsed.data.title,
      description: parsed.data.description,
      speakers: parsed.data.speakers,
      imageUrl: parsed.data.imageUrl || null,
      zoomLink: parsed.data.zoomLink || null,
      recordingUrl: parsed.data.recordingUrl || null,
      fileUrl: parsed.data.fileUrl || null,
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
      title: parsed.data.title,
      description: parsed.data.description,
      speakers: parsed.data.speakers,
      imageUrl: parsed.data.imageUrl || null,
      zoomLink: parsed.data.zoomLink || null,
      recordingUrl: parsed.data.recordingUrl || null,
      fileUrl: parsed.data.fileUrl || null,
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

  const sessionRow = await findSessionOr404(req.params.id);
  if (!sessionRow) {
    return res.status(404).json({ error: "Session not found" });
  }

  const userId = req.user?.id || "";
  const prior = await prisma.sessionAttendance.findUnique({
    where: { userId_sessionId: { userId, sessionId: req.params.id } },
  });

  const nextJoinMode =
    parsed.data.status === "NOT_JOINING"
      ? null
      : parsed.data.joinMode ?? prior?.joinMode ?? "IN_PERSON";

  await prisma.sessionAttendance.upsert({
    where: {
      userId_sessionId: {
        userId,
        sessionId: req.params.id,
      },
    },
    update: { status: parsed.data.status, joinMode: nextJoinMode },
    create: {
      userId,
      sessionId: req.params.id,
      status: parsed.data.status,
      joinMode: parsed.data.status === "NOT_JOINING" ? null : parsed.data.joinMode ?? "IN_PERSON",
    },
  });

  const wasJoining = prior?.status === "JOINING";
  const nowJoining = parsed.data.status === "JOINING";
  if (nowJoining && !wasJoining) {
    await awardEngagementPoints(userId, POINTS.SESSION_JOIN);
  }

  return res.json({ ok: true });
});

sessionsRouter.put("/:id/like", requireAuth, async (req: AuthedRequest, res) => {
  const sessionRow = await findSessionOr404(req.params.id);
  if (!sessionRow) {
    return res.status(404).json({ error: "Session not found" });
  }

  const userId = req.user?.id || "";
  const existing = await prisma.sessionLike.findUnique({
    where: { userId_sessionId: { userId, sessionId: req.params.id } },
  });
  if (!existing) {
    await prisma.sessionLike.create({
      data: { userId, sessionId: req.params.id },
    });
    await awardEngagementPoints(userId, POINTS.SESSION_LIKE);
  }
  return res.json({ ok: true });
});

sessionsRouter.delete("/:id/like", requireAuth, async (req: AuthedRequest, res) => {
  const sessionRow = await findSessionOr404(req.params.id);
  if (!sessionRow) {
    return res.status(404).json({ error: "Session not found" });
  }

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
  if (!conversation) {
    return res.status(404).json({ error: "Session not found" });
  }

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
  if (!conversation) {
    return res.status(404).json({ error: "Session not found" });
  }

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

  await awardEngagementPoints(userId, POINTS.SESSION_CHAT_MESSAGE);
  return res.json(message);
});
