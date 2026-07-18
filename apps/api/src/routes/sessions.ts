import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { asyncHandler, HttpError, requireEventAccess } from "../lib/authorization";
import { prisma } from "../lib/db";
import { awardEngagementPoints, POINTS } from "../lib/points";
import { resolveEventFromRequest } from "../lib/requestEvent";
import { getStorageProvider } from "../lib/storage";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";
import { requireFeature } from "../lib/features";

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
  /** null = unlimited */
  inPersonCapacity: z.number().int().positive().nullable().optional(),
  virtualCapacity: z.number().int().positive().nullable().optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  speakerId: z.string().optional(),
  trackId: z.string().nullable().optional(),
  roomId: z.string().nullable().optional(),
  /** Event-scoped Speaker roster IDs (ordered). */
  speakerIds: z.array(z.string()).optional(),
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
  track: { select: { id: true, name: true, color: true } },
  room: { select: { id: true, name: true } },
  sessionSpeakers: {
    orderBy: { sortOrder: "asc" as const },
    include: {
      speaker: {
        select: { id: true, name: true, title: true, affiliation: true, photoUrl: true },
      },
    },
  },
  items: {
    orderBy: { sortOrder: "asc" as const },
    include: {
      authors: { orderBy: { sortOrder: "asc" as const } },
      discussantSpeaker: { select: { id: true, name: true } },
    },
  },
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
  waitlistEntries: {
    orderBy: [{ mode: "asc" as const }, { position: "asc" as const }],
    select: {
      id: true,
      userId: true,
      mode: true,
      position: true,
      createdAt: true,
      promotedAt: true,
      holdExpiresAt: true,
      user: { select: { id: true, name: true, email: true, photoUrl: true } },
    },
  },
  likes: {
    select: {
      userId: true,
      user: { select: { id: true, name: true, email: true, photoUrl: true } },
    },
  },
} satisfies Prisma.SessionInclude;

async function syncSessionSpeakers(sessionId: string, eventId: string, speakerIds: string[]) {
  const unique = [...new Set(speakerIds)];
  if (unique.length) {
    const valid = await prisma.speaker.findMany({
      where: { eventId, id: { in: unique } },
      select: { id: true },
    });
    if (valid.length !== unique.length) {
      throw new HttpError(400, { error: "One or more speakers are not on this event roster" });
    }
  }
  await prisma.$transaction(async (tx) => {
    await tx.sessionSpeaker.deleteMany({ where: { sessionId } });
    for (let i = 0; i < unique.length; i += 1) {
      await tx.sessionSpeaker.create({
        data: { sessionId, speakerId: unique[i], sortOrder: i },
      });
    }
  });
}

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
      return res.json({ attendance: [], likedSessionIds: [], bookmarkedSessionIds: [] });
    }

    const saved = await prisma.sessionAttendance.findMany({
      where: { userId: req.user!.id, sessionId: { in: sessionIds } },
      select: { sessionId: true, status: true, joinMode: true },
    });
    const likes = await prisma.sessionLike.findMany({
      where: { userId: req.user!.id, sessionId: { in: sessionIds } },
      select: { sessionId: true },
    });
    const bookmarks = await prisma.sessionBookmark.findMany({
      where: { userId: req.user!.id, sessionId: { in: sessionIds } },
      select: { sessionId: true },
    });
    return res.json({
      attendance: saved,
      likedSessionIds: likes.map((like) => like.sessionId),
      bookmarkedSessionIds: bookmarks.map((b) => b.sessionId),
    });
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
    let storageKey: string | null = null;
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
    } else {
      try {
        const stored = await getStorageProvider().acceptUpload({
          url,
          keyPrefix: `events/${session.eventId}/sessions/${session.id}`,
          maxBytes: Number(process.env.STORAGE_MAX_UPLOAD_BYTES || 4_500_000),
        });
        url = stored.url;
        storageKey = stored.storageKey;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed";
        return res.status(400).json({ error: message });
      }
    }

    const userId = req.user!.id;
    const resource = await prisma.sessionResource.create({
      data: {
        title: parsed.data.title.trim(),
        kind: parsed.data.kind,
        url,
        storageKey,
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
        trackId: parsed.data.trackId ?? null,
        roomId: parsed.data.roomId ?? null,
        allowVirtualJoin: parsed.data.allowVirtualJoin ?? true,
        inPersonCapacity: parsed.data.inPersonCapacity === undefined ? null : parsed.data.inPersonCapacity,
        virtualCapacity: parsed.data.virtualCapacity === undefined ? null : parsed.data.virtualCapacity,
        startsAt: new Date(parsed.data.startsAt),
        endsAt: new Date(parsed.data.endsAt),
        eventId: event.id,
      },
      include: sessionInclude,
    });
    if (parsed.data.speakerIds) {
      await syncSessionSpeakers(session.id, event.id, parsed.data.speakerIds);
    }
    const full = await prisma.session.findUnique({
      where: { id: session.id },
      include: sessionInclude,
    });
    return res.json(full);
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
    if (parsed.data.inPersonCapacity !== undefined) {
      sessionUpdate.inPersonCapacity = parsed.data.inPersonCapacity;
    }
    if (parsed.data.virtualCapacity !== undefined) {
      sessionUpdate.virtualCapacity = parsed.data.virtualCapacity;
    }
    if (parsed.data.trackId !== undefined) {
      sessionUpdate.trackId = parsed.data.trackId;
    }
    if (parsed.data.roomId !== undefined) {
      sessionUpdate.roomId = parsed.data.roomId;
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

    if (parsed.data.speakerIds) {
      await syncSessionSpeakers(session.id, existing.eventId, parsed.data.speakerIds);
    }

    const full = await prisma.session.findUnique({
      where: { id: session.id },
      include: sessionInclude,
    });
    return res.json(full);
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

    const {
      joinSessionOrWaitlist,
      leaveSessionAttendance,
    } = await import("../lib/waitlist/capacity");

    if (parsed.data.status === "NOT_JOINING") {
      await leaveSessionAttendance({ sessionId: req.params.id, userId });
      return res.json({ ok: true, status: "NOT_JOINING" });
    }

    const nextJoinMode = parsed.data.joinMode ?? prior?.joinMode ?? "IN_PERSON";
    if (nextJoinMode === "VIRTUAL" && sessionRow.allowVirtualJoin === false) {
      return res.status(400).json({ error: "Virtual joining is not available for this session" });
    }

    // Mode change while already joining: leave old bucket then join new (frees seat → may promote)
    if (
      prior?.status === "JOINING" &&
      prior.joinMode &&
      prior.joinMode !== nextJoinMode
    ) {
      await leaveSessionAttendance({ sessionId: req.params.id, userId });
    }

    const result = await joinSessionOrWaitlist({
      sessionId: req.params.id,
      userId,
      mode: nextJoinMode,
    });

    const wasJoining = prior?.status === "JOINING";
    if (result.kind === "joined" && !wasJoining) {
      await awardEngagementPoints(userId, POINTS.SESSION_JOIN);
    }

    if (result.kind === "waitlisted") {
      return res.status(409).json({
        ok: false,
        code: "SESSION_FULL",
        waitlisted: true,
        position: result.position,
        capacity: result.capacity,
        current: result.current,
        error: result.message,
        message: result.message,
      });
    }

    return res.json({ ok: true, status: "JOINING", joinMode: nextJoinMode });
  }),
);

sessionsRouter.get(
  "/:id/waitlist",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const sessionRow = await findSessionWithEvent(req.params.id);
    if (!sessionRow) throw new HttpError(404, { error: "Session not found" });
    const access = await requireEventAccess(req.user!.id, sessionRow.eventId);
    const { listWaitlist } = await import("../lib/waitlist/capacity");
    const { featureEnabled } = await import("../lib/features");
    const entries = await listWaitlist(req.params.id);
    const showPositions = await featureEnabled(sessionRow.eventId, "waitlist_visibility");

    if (!access.canManageEvent && !showPositions) {
      const mine = entries.find((e) => e.userId === req.user!.id);
      return res.json({
        entries: mine
          ? [{ id: mine.id, mode: mine.mode, position: mine.position, promotedAt: mine.promotedAt, holdExpiresAt: mine.holdExpiresAt, isYou: true }]
          : [],
        showPositions: false,
      });
    }

    if (!access.canManageEvent) {
      return res.json({
        entries: entries.map((e) => ({
          id: e.id,
          mode: e.mode,
          position: e.position,
          promotedAt: e.promotedAt,
          holdExpiresAt: e.holdExpiresAt,
          isYou: e.userId === req.user!.id,
          user: e.userId === req.user!.id ? e.user : { id: e.userId, name: e.user.name },
        })),
        showPositions: true,
      });
    }

    return res.json({ entries, showPositions: true });
  }),
);

sessionsRouter.post(
  "/:id/waitlist/:entryId/promote",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const sessionRow = await findSessionWithEvent(req.params.id);
    if (!sessionRow) throw new HttpError(404, { error: "Session not found" });
    await requireEventAccess(req.user!.id, sessionRow.eventId, { manage: true });
    const { manualPromoteEntry } = await import("../lib/waitlist/capacity");
    await manualPromoteEntry(req.params.entryId);
    return res.json({ ok: true });
  }),
);

sessionsRouter.delete(
  "/:id/waitlist/:entryId",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const sessionRow = await findSessionWithEvent(req.params.id);
    if (!sessionRow) throw new HttpError(404, { error: "Session not found" });
    const access = await requireEventAccess(req.user!.id, sessionRow.eventId);
    const entry = await prisma.waitlistEntry.findUnique({ where: { id: req.params.entryId } });
    if (!entry || entry.sessionId !== req.params.id) {
      throw new HttpError(404, { error: "Waitlist entry not found" });
    }
    if (!access.canManageEvent && entry.userId !== req.user!.id) {
      throw new HttpError(403, { error: "Forbidden" });
    }
    const { removeWaitlistEntry } = await import("../lib/waitlist/capacity");
    await removeWaitlistEntry(req.params.entryId);
    return res.json({ ok: true });
  }),
);

sessionsRouter.post(
  "/waitlist/expire-holds",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    // Organizers can trigger expiry sweep; also useful for tests.
    if (req.user!.role !== "ADMIN") {
      throw new HttpError(403, { error: "Forbidden" });
    }
    const { expireAllHolds } = await import("../lib/waitlist/capacity");
    const promoted = await expireAllHolds();
    return res.json({ ok: true, promoted });
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
    await requireFeature(sessionRow.eventId, "session_likes");

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
    await requireFeature(sessionRow.eventId, "session_likes");

    await prisma.sessionLike.deleteMany({
      where: {
        userId: req.user!.id,
        sessionId: req.params.id,
      },
    });
    return res.json({ ok: true });
  }),
);

sessionsRouter.put(
  "/:id/bookmark",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const sessionRow = await findSessionWithEvent(req.params.id);
    if (!sessionRow) throw new HttpError(404, { error: "Session not found" });
    await requireEventAccess(req.user!.id, sessionRow.eventId);
    const userId = req.user!.id;
    await prisma.sessionBookmark.upsert({
      where: { userId_sessionId: { userId, sessionId: req.params.id } },
      create: { userId, sessionId: req.params.id },
      update: {},
    });
    return res.json({ ok: true });
  }),
);

sessionsRouter.delete(
  "/:id/bookmark",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const sessionRow = await findSessionWithEvent(req.params.id);
    if (!sessionRow) throw new HttpError(404, { error: "Session not found" });
    await requireEventAccess(req.user!.id, sessionRow.eventId);
    await prisma.sessionBookmark.deleteMany({
      where: { userId: req.user!.id, sessionId: req.params.id },
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
    await requireFeature(session.eventId, "session_qa");

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
    await requireFeature(session.eventId, "session_qa");

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

const itemAuthorSchema = z.object({
  name: z.string().min(1).max(200),
  speakerId: z.string().nullable().optional(),
  isPresenter: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

const sessionItemSchema = z.object({
  title: z.string().min(1).max(500),
  abstract: z.string().max(20_000).optional().nullable(),
  sortOrder: z.number().int().optional(),
  discussantName: z.string().max(200).optional().nullable(),
  discussantSpeakerId: z.string().nullable().optional(),
  authors: z.array(itemAuthorSchema).optional(),
});

const itemInclude = {
  authors: { orderBy: { sortOrder: "asc" as const } },
  discussantSpeaker: { select: { id: true, name: true } },
} as const;

sessionsRouter.get(
  "/:id/items",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const session = await findSessionWithEvent(req.params.id);
    if (!session) throw new HttpError(404, { error: "Session not found" });
    await requireEventAccess(req.user!.id, session.eventId);
    const items = await prisma.sessionItem.findMany({
      where: { sessionId: session.id },
      orderBy: { sortOrder: "asc" },
      include: itemInclude,
    });
    return res.json(items);
  }),
);

sessionsRouter.post(
  "/:id/items",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = sessionItemSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const session = await findSessionWithEvent(req.params.id);
    if (!session) throw new HttpError(404, { error: "Session not found" });
    await requireEventAccess(req.user!.id, session.eventId, { manage: true });

    let sortOrder = parsed.data.sortOrder;
    if (sortOrder === undefined) {
      const agg = await prisma.sessionItem.aggregate({
        where: { sessionId: session.id },
        _max: { sortOrder: true },
      });
      sortOrder = (agg._max.sortOrder ?? -1) + 1;
    }

    const item = await prisma.sessionItem.create({
      data: {
        sessionId: session.id,
        title: parsed.data.title.trim(),
        abstract: parsed.data.abstract?.trim() || null,
        sortOrder,
        discussantName: parsed.data.discussantName?.trim() || null,
        discussantSpeakerId: parsed.data.discussantSpeakerId || null,
        authors: parsed.data.authors?.length
          ? {
              create: parsed.data.authors.map((a, i) => ({
                name: a.name.trim(),
                speakerId: a.speakerId || null,
                isPresenter: a.isPresenter ?? false,
                sortOrder: a.sortOrder ?? i,
              })),
            }
          : undefined,
      },
      include: itemInclude,
    });
    return res.status(201).json(item);
  }),
);

sessionsRouter.put(
  "/:id/items/:itemId",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = sessionItemSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const session = await findSessionWithEvent(req.params.id);
    if (!session) throw new HttpError(404, { error: "Session not found" });
    await requireEventAccess(req.user!.id, session.eventId, { manage: true });

    const existing = await prisma.sessionItem.findFirst({
      where: { id: req.params.itemId, sessionId: session.id },
    });
    if (!existing) throw new HttpError(404, { error: "Session item not found" });

    await prisma.$transaction(async (tx) => {
      await tx.sessionItem.update({
        where: { id: existing.id },
        data: {
          ...(parsed.data.title !== undefined ? { title: parsed.data.title.trim() } : {}),
          ...(parsed.data.abstract !== undefined ? { abstract: parsed.data.abstract?.trim() || null } : {}),
          ...(parsed.data.sortOrder !== undefined ? { sortOrder: parsed.data.sortOrder } : {}),
          ...(parsed.data.discussantName !== undefined
            ? { discussantName: parsed.data.discussantName?.trim() || null }
            : {}),
          ...(parsed.data.discussantSpeakerId !== undefined
            ? { discussantSpeakerId: parsed.data.discussantSpeakerId }
            : {}),
        },
      });
      if (parsed.data.authors) {
        await tx.sessionItemAuthor.deleteMany({ where: { sessionItemId: existing.id } });
        for (let i = 0; i < parsed.data.authors.length; i += 1) {
          const a = parsed.data.authors[i];
          await tx.sessionItemAuthor.create({
            data: {
              sessionItemId: existing.id,
              name: a.name.trim(),
              speakerId: a.speakerId || null,
              isPresenter: a.isPresenter ?? false,
              sortOrder: a.sortOrder ?? i,
            },
          });
        }
      }
    });

    const item = await prisma.sessionItem.findUniqueOrThrow({
      where: { id: existing.id },
      include: itemInclude,
    });
    return res.json(item);
  }),
);

sessionsRouter.post(
  "/:id/items/reorder",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = z.object({ itemIds: z.array(z.string()).min(1) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const session = await findSessionWithEvent(req.params.id);
    if (!session) throw new HttpError(404, { error: "Session not found" });
    await requireEventAccess(req.user!.id, session.eventId, { manage: true });

    const existing = await prisma.sessionItem.findMany({
      where: { sessionId: session.id },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((i) => i.id));
    if (parsed.data.itemIds.some((id) => !existingIds.has(id))) {
      return res.status(400).json({ error: "itemIds must belong to this session" });
    }

    await prisma.$transaction(
      parsed.data.itemIds.map((id, sortOrder) =>
        prisma.sessionItem.update({ where: { id }, data: { sortOrder } }),
      ),
    );

    const items = await prisma.sessionItem.findMany({
      where: { sessionId: session.id },
      orderBy: { sortOrder: "asc" },
      include: itemInclude,
    });
    return res.json(items);
  }),
);

sessionsRouter.delete(
  "/:id/items/:itemId",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const session = await findSessionWithEvent(req.params.id);
    if (!session) throw new HttpError(404, { error: "Session not found" });
    await requireEventAccess(req.user!.id, session.eventId, { manage: true });
    const existing = await prisma.sessionItem.findFirst({
      where: { id: req.params.itemId, sessionId: session.id },
    });
    if (!existing) throw new HttpError(404, { error: "Session item not found" });
    await prisma.sessionItem.delete({ where: { id: existing.id } });
    return res.json({ ok: true });
  }),
);

