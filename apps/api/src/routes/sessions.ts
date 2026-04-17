import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db";
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

const threadSchema = z.object({
  title: z.string().min(1).max(500),
  body: z.string().min(1).max(8000),
});

const replySchema = z.object({
  body: z.string().min(1).max(8000),
});

const resourceSchema = z.object({
  title: z.string().min(1).max(200),
  kind: z.enum(["LINK", "FILE"]),
  url: z.string().min(1).max(5_000_000),
});

async function findSessionOr404(sessionId: string) {
  const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { id: true } });
  return session;
}

function normalizeLinkUrl(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

async function assertCanContributeSessionResources(userId: string, sessionId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (user?.role === "ADMIN") return;

  const attendance = await prisma.sessionAttendance.findUnique({
    where: { userId_sessionId: { userId, sessionId } },
    select: { status: true },
  });
  if (attendance?.status !== "JOINING") {
    throw new Error("FORBIDDEN_RESOURCE");
  }
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

sessionsRouter.get("/:id/resources", requireAuth, async (req: AuthedRequest, res) => {
  const session = await findSessionOr404(req.params.id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  const userId = req.user?.id || "";
  try {
    await assertCanContributeSessionResources(userId, session.id);
  } catch {
    return res.status(403).json({ error: "Join this session to view resources" });
  }

  const resources = await prisma.sessionResource.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { id: true, name: true, role: true } },
    },
  });

  return res.json(resources);
});

sessionsRouter.post("/:id/resources", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = resourceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const session = await findSessionOr404(req.params.id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  const userId = req.user?.id || "";
  try {
    await assertCanContributeSessionResources(userId, session.id);
  } catch {
    return res.status(403).json({ error: "Join this session to share resources" });
  }

  let url = parsed.data.url.trim();
  if (parsed.data.kind === "LINK") {
    url = normalizeLinkUrl(url);
    try {
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        return res.status(400).json({ error: "Invalid link URL" });
      }
    } catch {
      return res.status(400).json({ error: "Invalid link URL" });
    }
  } else if (!url.startsWith("data:")) {
    return res.status(400).json({ error: "File uploads must use a data URL" });
  }

  const resource = await prisma.sessionResource.create({
    data: {
      title: parsed.data.title.trim(),
      kind: parsed.data.kind,
      url,
      sessionId: session.id,
      userId,
    },
    include: {
      user: { select: { id: true, name: true, role: true } },
    },
  });

  await awardEngagementPoints(userId, POINTS.SESSION_RESOURCE);
  return res.json(resource);
});

sessionsRouter.delete("/:id/resources/:resourceId", requireAuth, async (req: AuthedRequest, res) => {
  const session = await findSessionOr404(req.params.id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  const resource = await prisma.sessionResource.findFirst({
    where: { id: req.params.resourceId, sessionId: session.id },
  });
  if (!resource) {
    return res.status(404).json({ error: "Resource not found" });
  }

  const userId = req.user?.id || "";
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  const isAdmin = user?.role === "ADMIN";
  const isOwner = resource.userId === userId;
  if (!isAdmin && !isOwner) {
    return res.status(403).json({ error: "Not allowed to delete this resource" });
  }

  await prisma.sessionResource.delete({ where: { id: resource.id } });
  return res.json({ ok: true });
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
  const sessionId = req.params.id;
  const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { id: true } });
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  await prisma.$transaction(async (tx) => {
    await tx.sessionBookmark.deleteMany({ where: { sessionId } });
    await tx.sessionAttendance.deleteMany({ where: { sessionId } });
    await tx.sessionLike.deleteMany({ where: { sessionId } });

    const conv = await tx.conversation.findFirst({ where: { sessionId } });
    if (conv) {
      await tx.conversationMessage.deleteMany({ where: { conversationId: conv.id } });
      await tx.conversationMember.deleteMany({ where: { conversationId: conv.id } });
      await tx.conversation.delete({ where: { id: conv.id } });
    }

    await tx.session.delete({ where: { id: sessionId } });
  });

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

sessionsRouter.get("/:id/conversations", requireAuth, async (req, res) => {
  const session = await findSessionOr404(req.params.id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  const threads = await prisma.sessionDiscussionThread.findMany({
    where: { sessionId: session.id },
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

sessionsRouter.post("/:id/conversations", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = threadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const session = await findSessionOr404(req.params.id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  const userId = req.user?.id || "";
  const thread = await prisma.sessionDiscussionThread.create({
    data: {
      sessionId: session.id,
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

sessionsRouter.post("/:id/conversations/:threadId/replies", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = replySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const session = await findSessionOr404(req.params.id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  const thread = await prisma.sessionDiscussionThread.findFirst({
    where: { id: req.params.threadId, sessionId: session.id },
  });
  if (!thread) {
    return res.status(404).json({ error: "Conversation not found" });
  }

  const userId = req.user?.id || "";
  const reply = await prisma.sessionDiscussionReply.create({
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

sessionsRouter.delete("/:id/conversations/:threadId", requireAuth, requireRole(["ADMIN"]), async (req, res) => {
  const session = await findSessionOr404(req.params.id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  const thread = await prisma.sessionDiscussionThread.findFirst({
    where: { id: req.params.threadId, sessionId: session.id },
  });
  if (!thread) {
    return res.status(404).json({ error: "Conversation not found" });
  }

  await prisma.sessionDiscussionThread.delete({ where: { id: thread.id } });
  return res.json({ ok: true });
});
