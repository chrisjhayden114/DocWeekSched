import { NetworkChannel } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db";
import { notifyNewCommunityThread, notifyCommunityReply } from "../lib/notifications";
import { awardEngagementPoints, POINTS } from "../lib/points";
import { resolveEventFromRequest } from "../lib/requestEvent";
import { AuthedRequest, requireAuth, requireRole } from "../lib/middleware";

export const networkRouter = Router();

const threadSchema = z.object({
  title: z.string().min(1).max(500),
  body: z.string().min(1).max(8000),
  channel: z.nativeEnum(NetworkChannel).optional(),
  meetupMode: z.enum(["VIRTUAL", "IN_PERSON"]).optional(),
  meetupStartsAt: z.string().datetime().optional(),
  meetupMeetingUrl: z.string().max(4000).optional(),
  meetupInviteEveryone: z.boolean().optional(),
  meetupParticipantIds: z.array(z.string().min(1)).max(500).optional(),
  taggedUserIds: z.array(z.string().min(1)).max(80).optional(),
  imageUrl: z.string().max(2_000_000).optional(),
  imageUrls: z.array(z.string().max(2_000_000)).max(12).optional(),
  mapsUrl: z.string().max(4000).optional(),
});

const replySchema = z.object({
  body: z.string().min(1).max(8000),
});

networkRouter.get("/threads", requireAuth, async (req, res) => {
  const event = await resolveEventFromRequest(req);
  const rawChannel = typeof req.query.channel === "string" ? req.query.channel : undefined;
  const allowed: NetworkChannel[] = ["GENERAL", "MEETUP", "MOMENTS", "LOCAL", "ICEBREAKER"];
  const channel =
    rawChannel && (allowed as string[]).includes(rawChannel) ? (rawChannel as NetworkChannel) : undefined;
  const threads = await prisma.networkThread.findMany({
    where: channel ? { eventId: event.id, channel } : { eventId: event.id },
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
  const channel = parsed.data.channel ?? NetworkChannel.GENERAL;

  let meetupInviteEveryone = false;
  let meetupParticipantIds: string[] = [];
  let taggedUserIds: string[] = [];

  let meetupMeetingUrl: string | null = null;

  if (channel === NetworkChannel.MEETUP) {
    meetupInviteEveryone = parsed.data.meetupInviteEveryone === true;
    meetupParticipantIds = Array.from(new Set(parsed.data.meetupParticipantIds ?? []));
    if (!meetupInviteEveryone && meetupParticipantIds.length === 0) {
      return res.status(400).json({ error: "Add participants or choose Invite everyone." });
    }
    if (meetupInviteEveryone) {
      meetupParticipantIds = [];
    }
    if (meetupParticipantIds.length) {
      const n = await prisma.user.count({ where: { id: { in: meetupParticipantIds } } });
      if (n !== meetupParticipantIds.length) {
        return res.status(400).json({ error: "One or more participants are invalid." });
      }
    }
    const mode = parsed.data.meetupMode ?? null;
    if (mode === "VIRTUAL") {
      const raw = parsed.data.meetupMeetingUrl?.trim() ?? "";
      if (!raw) {
        return res.status(400).json({
          error: "Virtual meet-ups need a video link (Zoom, Google Meet, Microsoft Teams, etc.).",
        });
      }
      meetupMeetingUrl = raw.slice(0, 4000);
    }
  }

  if (channel === NetworkChannel.MOMENTS) {
    taggedUserIds = Array.from(new Set(parsed.data.taggedUserIds ?? []));
    if (taggedUserIds.length) {
      const n = await prisma.user.count({ where: { id: { in: taggedUserIds } } });
      if (n !== taggedUserIds.length) {
        return res.status(400).json({ error: "One or more tagged people are invalid." });
      }
    }
  }

  let imageUrls = (parsed.data.imageUrls ?? []).filter((u) => u && u.trim());
  const single = parsed.data.imageUrl?.trim();
  if (single && imageUrls.length === 0) {
    imageUrls = [single];
  }
  imageUrls = imageUrls.slice(0, 12);
  const imageUrl = imageUrls[0] ?? null;
  const mapsUrl =
    channel === NetworkChannel.LOCAL ? (parsed.data.mapsUrl?.trim().slice(0, 4000) || null) : null;

  const thread = await prisma.networkThread.create({
    data: {
      eventId: event.id,
      authorId: userId,
      title: parsed.data.title,
      body: parsed.data.body,
      channel,
      meetupMode: parsed.data.meetupMode ?? null,
      meetupStartsAt: parsed.data.meetupStartsAt ? new Date(parsed.data.meetupStartsAt) : null,
      meetupMeetingUrl,
      meetupInviteEveryone,
      meetupParticipantIds,
      taggedUserIds,
      imageUrl,
      imageUrls,
      mapsUrl,
    },
    include: {
      author: { select: { id: true, name: true, role: true, photoUrl: true } },
      replies: {
        include: { author: { select: { id: true, name: true, role: true, photoUrl: true } } },
      },
    },
  });

  await awardEngagementPoints(userId, POINTS.NETWORK_THREAD);

  const authorName = thread.author.name;
  try {
    await notifyNewCommunityThread({
      eventId: event.id,
      threadId: thread.id,
      channel,
      title: thread.title,
      authorId: userId,
      authorName,
      meetupInviteEveryone,
      meetupParticipantIds,
    });
  } catch (err) {
    console.error("notifyNewCommunityThread failed:", err);
  }

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
    include: {
      replies: { select: { authorId: true } },
    },
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

  const priorReplierIds = Array.from(new Set(thread.replies.map((r) => r.authorId)));
  const fullThread = await prisma.networkThread.findUnique({
    where: { id: thread.id },
    select: { title: true, authorId: true },
  });
  if (fullThread) {
    try {
      await notifyCommunityReply({
        eventId: event.id,
        threadId: thread.id,
        threadTitle: fullThread.title,
        threadAuthorId: fullThread.authorId,
        replierId: userId,
        replierName: reply.author.name,
        replyPreview: parsed.data.body,
        priorReplierIds,
      });
    } catch (err) {
      console.error("notifyCommunityReply failed:", err);
    }
  }

  return res.json(reply);
});

networkRouter.delete("/threads/:id/replies/:replyId", requireAuth, requireRole(["ADMIN"]), async (req, res) => {
  const event = await resolveEventFromRequest(req);
  const thread = await prisma.networkThread.findFirst({
    where: { id: req.params.id, eventId: event.id },
    select: { id: true },
  });
  if (!thread) {
    return res.status(404).json({ error: "Thread not found" });
  }

  const reply = await prisma.networkReply.findFirst({
    where: { id: req.params.replyId, threadId: thread.id },
    select: { id: true },
  });
  if (!reply) {
    return res.status(404).json({ error: "Reply not found" });
  }

  await prisma.networkReply.delete({ where: { id: reply.id } });
  return res.json({ ok: true });
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
