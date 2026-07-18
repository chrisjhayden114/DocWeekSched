import { NetworkChannel } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler, HttpError, requireEventAccess } from "../lib/authorization";
import { prisma } from "../lib/db";
import { notifyNewCommunityThread, notifyCommunityReply } from "../lib/notifications";
import { awardEngagementPoints, POINTS } from "../lib/points";
import { resolveEventFromRequest } from "../lib/requestEvent";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";
import { featureKeyForNetworkChannel, requireFeature, featureEnabled } from "../lib/features";

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

async function assertEventMembers(eventId: string, userIds: string[]) {
  if (userIds.length === 0) return;
  const count = await prisma.eventMembership.count({
    where: { eventId, userId: { in: userIds } },
  });
  if (count !== userIds.length) {
    throw new HttpError(400, { error: "One or more participants are not event members." });
  }
}

networkRouter.get(
  "/threads",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id);
    await requireFeature(event.id, "community");

    const rawChannel = typeof req.query.channel === "string" ? req.query.channel : undefined;
    const allowed: NetworkChannel[] = ["GENERAL", "MEETUP", "MOMENTS", "LOCAL", "ICEBREAKER"];
    const channel =
      rawChannel && (allowed as string[]).includes(rawChannel) ? (rawChannel as NetworkChannel) : undefined;

    if (channel) {
      const channelKey = featureKeyForNetworkChannel(channel);
      if (channelKey) await requireFeature(event.id, channelKey);
    }

    const enabledChannels: NetworkChannel[] = [];
    for (const ch of allowed) {
      const key = featureKeyForNetworkChannel(ch);
      if (key && (await featureEnabled(event.id, key))) enabledChannels.push(ch);
    }

    const threads = await prisma.networkThread.findMany({
      where: channel
        ? { eventId: event.id, channel }
        : { eventId: event.id, channel: { in: enabledChannels } },
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

networkRouter.post(
  "/threads",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = threadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id);
    await requireFeature(event.id, "community");

    const userId = req.user!.id;
    const channel = parsed.data.channel ?? NetworkChannel.GENERAL;
    const channelKey = featureKeyForNetworkChannel(channel);
    if (channelKey) await requireFeature(event.id, channelKey);

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
        await assertEventMembers(event.id, meetupParticipantIds);
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
        await assertEventMembers(event.id, taggedUserIds);
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
  }),
);

networkRouter.post(
  "/threads/:id/replies",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = replySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id);

    const thread = await prisma.networkThread.findFirst({
      where: { id: req.params.id, eventId: event.id },
      include: {
        replies: { select: { authorId: true } },
      },
    });
    if (!thread) {
      throw new HttpError(404, { error: "Thread not found" });
    }

    const userId = req.user!.id;
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
  }),
);

networkRouter.delete(
  "/threads/:id/replies/:replyId",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });

    const thread = await prisma.networkThread.findFirst({
      where: { id: req.params.id, eventId: event.id },
      select: { id: true },
    });
    if (!thread) {
      throw new HttpError(404, { error: "Thread not found" });
    }

    const reply = await prisma.networkReply.findFirst({
      where: { id: req.params.replyId, threadId: thread.id },
      select: { id: true },
    });
    if (!reply) {
      throw new HttpError(404, { error: "Reply not found" });
    }

    await prisma.networkReply.delete({ where: { id: reply.id } });
    return res.json({ ok: true });
  }),
);

networkRouter.delete(
  "/threads/:id",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });

    const thread = await prisma.networkThread.findFirst({
      where: { id: req.params.id, eventId: event.id },
    });
    if (!thread) {
      throw new HttpError(404, { error: "Thread not found" });
    }

    await prisma.networkThread.delete({ where: { id: thread.id } });
    return res.json({ ok: true });
  }),
);

const threadEditSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  body: z.string().min(1).max(20_000).optional(),
});

networkRouter.patch(
  "/threads/:id",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = threadEditSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });

    const thread = await prisma.networkThread.findFirst({
      where: { id: req.params.id, eventId: event.id },
    });
    if (!thread) throw new HttpError(404, { error: "Thread not found" });

    const updated = await prisma.networkThread.update({
      where: { id: thread.id },
      data: {
        ...(parsed.data.title !== undefined ? { title: parsed.data.title.trim() } : {}),
        ...(parsed.data.body !== undefined ? { body: parsed.data.body.trim() } : {}),
      },
      include: {
        author: { select: { id: true, name: true, role: true, photoUrl: true } },
        replies: {
          orderBy: { createdAt: "asc" },
          include: { author: { select: { id: true, name: true, role: true, photoUrl: true } } },
        },
      },
    });
    return res.json(updated);
  }),
);

