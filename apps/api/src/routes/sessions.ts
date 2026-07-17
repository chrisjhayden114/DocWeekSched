import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { asyncHandler, HttpError, requireEventAccess } from "../lib/authorization";
import { prisma } from "../lib/db";
import { awardEngagementPoints, POINTS } from "../lib/points";
import { resolveEventFromRequest } from "../lib/requestEvent";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";

export const sessionsRouter = Router();

const optionalLink = z.string().max(5_000_000).optional();

const sessionSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  location: z.string().max(500).optional(),
  speakers: z.string().optional(),
  imageUrl: optionalLink,
  zoomLink: optionalLink,
  recordingUrl: optionalLink,
  fileUrl: optionalLink,
  fileLink: optionalLink,
  allowVirtualJoin: z.boolean().optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  speakerId: z.string().optional(),
});

const attendanceSchema = z.object({
  status: z.enum(["JOINING", "NOT_JOINING"]),
  joinMode: z.enum(["VIRTUAL", "IN_PERSON", "ASYNC"]).optional(),
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

async function findSessionWithEvent(sessionId: string) {
  return prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, eventId: true, allowVirtualJoin: true },
  });
}

function normalizeLinkUrl(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

async function assertCanContributeSessionResources(
  userId: string,
  session: { id: string; eventId: string },
) {
  try {
    await requireEventAccess(userId, session.eventId, { manage: true });
    return;
  } catch (err) {
    if (!(err instanceof HttpError) || err.status !== 403) throw err;
  }

  const attendance = await prisma.sessionAttendance.findUnique({
    where: { userId_sessionId: { userId, sessionId: session.id } },
    select: { status: true },
  });
  if (attendance?.status !== "JOINING") {
    throw new HttpError(403, { error: "Join this session to view resources" });
  }
}

const sessionInclude = {
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
} as const;

sessionsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id);

    const sessions = await prisma.session.findMany({
      where: { eventId: event.id },
      orderBy: { startsAt: "asc" },
      include: sessionInclude,
    });
    return res.json(sessions);
  }),
);

sessionsRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id);

    const eventSessionIds = await prisma.session.findMany({
      where: { eventId: event.id },
      select: { id: true },
    });
    const sessionIds = eventSessionIds.map((s) => s.id);
    if (sessionIds.length === 0) {
      return res.json({ attendance: [], likedSessionIds: [] });
    }

    const saved = await prisma.sessionAttendance.findMany({
      where: { userId: req.user!.id, sessionId: { in: sessionIds } },
      select: { sessionId: true, status: true, joinMode: true },
    });
    const likes = await prisma.sessionLike.findMany({
      where: { userId: req.user!.id, sessionId: { in: sessionIds } },
      select: { sessionId: true },
    });
    return res.json({ attendance: saved, likedSessionIds: likes.map((like) => like.sessionId) });
  }),
);

sessionsRouter.get(
  "/:id/resources",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const session = await findSessionWithEvent(req.params.id);
    if (!session) {
      throw new HttpError(404, { error: "Session not found" });
    }

    await requireEventAccess(req.user!.id, session.eventId);
    await assertCanContributeSessionResources(req.user!.id, session);

    const resources = await prisma.sessionResource.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, name: true, role: true } },
      },
    });

    return res.json(resources);
  }),
);

sessionsRouter.post(
  "/:id/resources",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = resourceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const session = await findSessionWithEvent(req.params.id);
    if (!session) {
      throw new HttpError(404, { error: "Session not found" });
    }

    await requireEventAccess(req.user!.id, session.eventId);
    await assertCanContributeSessionResources(req.user!.id, session);

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

    const userId = req.user!.id;
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
  }),
);

sessionsRouter.delete(
  "/:id/resources/:resourceId",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const session = await findSessionWithEvent(req.params.id);
    if (!session) {
      throw new HttpError(404, { error: "Session not found" });
    }

    await requireEventAccess(req.user!.id, session.eventId);

    const resource = await prisma.sessionResource.findFirst({
      where: { id: req.params.resourceId, sessionId: session.id },
    });
    if (!resource) {
      throw new HttpError(404, { error: "Resource not found" });
    }

    const userId = req.user!.id;
    let canManage = false;
    try {
      const access = await requireEventAccess(userId, session.eventId, { manage: true });
      canManage = access.canManageEvent;
    } catch (err) {
      if (!(err instanceof HttpError) || err.status !== 403) throw err;
    }

    const isOwner = resource.userId === userId;
    if (!canManage && !isOwner) {
      throw new HttpError(403, { error: "Not allowed to delete this resource" });
    }

    await prisma.sessionResource.delete({ where: { id: resource.id } });
    return res.json({ ok: true });
  }),
);

sessionsRouter.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const session = await findSessionWithEvent(req.params.id);
    if (!session) {
      throw new HttpError(404, { error: "Session not found" });
    }

    await requireEventAccess(req.user!.id, session.eventId);

    const full = await prisma.session.findUnique({
      where: { id: session.id },
      include: sessionInclude,
    });
    if (!full) {
      throw new HttpError(404, { error: "Session not found" });
    }

    return res.json(full);
  }),
);

sessionsRouter.post(
  "/",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = sessionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });

    const locationTrimmed = (parsed.data.location ?? "").trim();
    const session = await prisma.session.create({
      data: {
        title: parsed.data.title,
        description: parsed.data.description,
        location: locationTrimmed || null,
        speakers: parsed.data.speakers,
        imageUrl: parsed.data.imageUrl || null,
        zoomLink: parsed.data.zoomLink || null,
        recordingUrl: parsed.data.recordingUrl || null,
        fileUrl: parsed.data.fileUrl || null,
        fileLink: parsed.data.fileLink || null,
        speakerId: parsed.data.speakerId || null,
        allowVirtualJoin: parsed.data.allowVirtualJoin ?? true,
        startsAt: new Date(parsed.data.startsAt),
        endsAt: new Date(parsed.data.endsAt),
        eventId: event.id,
      },
    });
    return res.json(session);
  }),
);

sessionsRouter.put(
  "/:id",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = sessionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const existing = await findSessionWithEvent(req.params.id);
    if (!existing) {
      throw new HttpError(404, { error: "Session not found" });
    }
    await requireEventAccess(req.user!.id, existing.eventId, { manage: true });

    const locationTrimmed = (parsed.data.location ?? "").trim();
    const sessionUpdate: Prisma.SessionUncheckedUpdateInput = {
      title: parsed.data.title,
      description: parsed.data.description,
      location: locationTrimmed || null,
      speakers: parsed.data.speakers,
      imageUrl: parsed.data.imageUrl || null,
      zoomLink: parsed.data.zoomLink || null,
      recordingUrl: parsed.data.recordingUrl || null,
      fileUrl: parsed.data.fileUrl || null,
      fileLink: parsed.data.fileLink || null,
      speakerId: parsed.data.speakerId || null,
      startsAt: new Date(parsed.data.startsAt),
      endsAt: new Date(parsed.data.endsAt),
    };
    if (parsed.data.allowVirtualJoin !== undefined) {
      sessionUpdate.allowVirtualJoin = parsed.data.allowVirtualJoin;
    }

    const session = await prisma.$transaction(async (tx) => {
      const updated = await tx.session.update({
        where: { id: req.params.id },
        data: sessionUpdate,
      });

      if (parsed.data.allowVirtualJoin === false) {
        await tx.sessionAttendance.updateMany({
          where: { sessionId: req.params.id, joinMode: "VIRTUAL" },
          data: { joinMode: "IN_PERSON" },
        });
      }

      return updated;
    });

    return res.json(session);
  }),
);

sessionsRouter.delete(
  "/:id",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const sessionId = req.params.id;
    const existing = await findSessionWithEvent(sessionId);
    if (!existing) {
      throw new HttpError(404, { error: "Session not found" });
    }
    await requireEventAccess(req.user!.id, existing.eventId, { manage: true });

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
  }),
);

sessionsRouter.put(
  "/:id/attendance",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = attendanceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const sessionRow = await findSessionWithEvent(req.params.id);
    if (!sessionRow) {
      throw new HttpError(404, { error: "Session not found" });
    }
    await requireEventAccess(req.user!.id, sessionRow.eventId);

    const userId = req.user!.id;
    const prior = await prisma.sessionAttendance.findUnique({
      where: { userId_sessionId: { userId, sessionId: req.params.id } },
    });

    const nextJoinMode =
      parsed.data.status === "NOT_JOINING"
        ? null
        : parsed.data.joinMode ?? prior?.joinMode ?? "IN_PERSON";

    if (nextJoinMode === "VIRTUAL" && sessionRow.allowVirtualJoin === false) {
      return res.status(400).json({ error: "Virtual joining is not available for this session" });
    }

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
  }),
);

sessionsRouter.put(
  "/:id/like",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const sessionRow = await findSessionWithEvent(req.params.id);
    if (!sessionRow) {
      throw new HttpError(404, { error: "Session not found" });
    }
    await requireEventAccess(req.user!.id, sessionRow.eventId);

    const userId = req.user!.id;
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
  }),
);

sessionsRouter.delete(
  "/:id/like",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const sessionRow = await findSessionWithEvent(req.params.id);
    if (!sessionRow) {
      throw new HttpError(404, { error: "Session not found" });
    }
    await requireEventAccess(req.user!.id, sessionRow.eventId);

    await prisma.sessionLike.deleteMany({
      where: {
        userId: req.user!.id,
        sessionId: req.params.id,
      },
    });
    return res.json({ ok: true });
  }),
);

sessionsRouter.get(
  "/:id/conversations",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const session = await findSessionWithEvent(req.params.id);
    if (!session) {
      throw new HttpError(404, { error: "Session not found" });
    }
    await requireEventAccess(req.user!.id, session.eventId);

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
  }),
);

sessionsRouter.post(
  "/:id/conversations",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = threadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const session = await findSessionWithEvent(req.params.id);
    if (!session) {
      throw new HttpError(404, { error: "Session not found" });
    }
    await requireEventAccess(req.user!.id, session.eventId);

    const userId = req.user!.id;
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
  }),
);

sessionsRouter.post(
  "/:id/conversations/:threadId/replies",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = replySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const session = await findSessionWithEvent(req.params.id);
    if (!session) {
      throw new HttpError(404, { error: "Session not found" });
    }
    await requireEventAccess(req.user!.id, session.eventId);

    const thread = await prisma.sessionDiscussionThread.findFirst({
      where: { id: req.params.threadId, sessionId: session.id },
    });
    if (!thread) {
      throw new HttpError(404, { error: "Conversation not found" });
    }

    const userId = req.user!.id;
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
  }),
);

sessionsRouter.delete(
  "/:id/conversations/:threadId/replies/:replyId",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const session = await findSessionWithEvent(req.params.id);
    if (!session) {
      throw new HttpError(404, { error: "Session not found" });
    }
    await requireEventAccess(req.user!.id, session.eventId, { manage: true });

    const thread = await prisma.sessionDiscussionThread.findFirst({
      where: { id: req.params.threadId, sessionId: session.id },
      select: { id: true },
    });
    if (!thread) {
      throw new HttpError(404, { error: "Conversation not found" });
    }

    const reply = await prisma.sessionDiscussionReply.findFirst({
      where: { id: req.params.replyId, threadId: thread.id },
      select: { id: true },
    });
    if (!reply) {
      throw new HttpError(404, { error: "Reply not found" });
    }

    await prisma.sessionDiscussionReply.delete({ where: { id: reply.id } });
    return res.json({ ok: true });
  }),
);

sessionsRouter.delete(
  "/:id/conversations/:threadId",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const session = await findSessionWithEvent(req.params.id);
    if (!session) {
      throw new HttpError(404, { error: "Session not found" });
    }
    await requireEventAccess(req.user!.id, session.eventId, { manage: true });

    const thread = await prisma.sessionDiscussionThread.findFirst({
      where: { id: req.params.threadId, sessionId: session.id },
    });
    if (!thread) {
      throw new HttpError(404, { error: "Conversation not found" });
    }

    await prisma.sessionDiscussionThread.delete({ where: { id: thread.id } });
    return res.json({ ok: true });
  }),
);
