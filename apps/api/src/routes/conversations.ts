import { Router } from "express";
import { z } from "zod";
import { asyncHandler, HttpError, requireEventAccess } from "../lib/authorization";
import { prisma } from "../lib/db";
import { getDirectConversation, getOrCreateEventConversation } from "../lib/conversations";
import { allAttendeeUserIds, notifyNewMessage } from "../lib/notifications";
import { awardEngagementPoints, POINTS } from "../lib/points";
import { resolveEventFromRequest } from "../lib/requestEvent";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";

export const conversationsRouter = Router();

const createGroupSchema = z.object({
  name: z.string().min(1),
  memberIds: z.array(z.string()).min(1),
});

const createDirectSchema = z.object({
  userId: z.string().min(1),
});

const messageSchema = z.object({
  body: z.string().min(1),
});

async function assertEventMembers(eventId: string, userIds: string[]) {
  if (userIds.length === 0) return;
  const count = await prisma.eventMembership.count({
    where: { eventId, userId: { in: userIds }, deletedAt: null },
  });
  if (count !== userIds.length) {
    throw new HttpError(400, { error: "One or more members are not part of this event" });
  }
}

conversationsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const userId = req.user!.id;
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(userId, event.id);
    await getOrCreateEventConversation(event.id);

    const conversations = await prisma.conversation.findMany({
      where: {
        eventId: event.id,
        OR: [{ type: "EVENT" }, { members: { some: { userId } } }],
      },
      include: {
        members: { include: { user: { select: { id: true, name: true, role: true } } } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { user: { select: { id: true, name: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json(conversations);
  }),
);

conversationsRouter.post(
  "/direct",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = createDirectSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const userId = req.user!.id;
    const otherUserId = parsed.data.userId;
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(userId, event.id);
    await assertEventMembers(event.id, [otherUserId]);

    const existing = await getDirectConversation(userId, otherUserId, event.id);
    if (existing) {
      const full = await prisma.conversation.findUnique({
        where: { id: existing.id },
        include: { members: { include: { user: { select: { id: true, name: true, role: true } } } } },
      });
      return res.json(full);
    }

    const conversation = await prisma.conversation.create({
      data: {
        eventId: event.id,
        type: "DIRECT",
        members: {
          create: [{ userId }, { userId: otherUserId }],
        },
      },
      include: { members: { include: { user: { select: { id: true, name: true, role: true } } } } },
    });

    return res.json(conversation);
  }),
);

conversationsRouter.post(
  "/group",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = createGroupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const userId = req.user!.id;
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(userId, event.id);

    const memberIds = Array.from(new Set([userId, ...parsed.data.memberIds]));
    await assertEventMembers(event.id, memberIds.filter((id) => id !== userId));

    const conversation = await prisma.conversation.create({
      data: {
        eventId: event.id,
        type: "GROUP",
        name: parsed.data.name,
        members: {
          create: memberIds.map((id) => ({ userId: id })),
        },
      },
      include: { members: { include: { user: { select: { id: true, name: true, role: true } } } } },
    });

    return res.json(conversation);
  }),
);

conversationsRouter.get(
  "/:id/messages",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const userId = req.user!.id;
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: { members: true },
    });

    if (!conversation) {
      throw new HttpError(404, { error: "Conversation not found" });
    }

    await requireEventAccess(userId, conversation.eventId);

    if (conversation.type !== "EVENT" && !conversation.members.some((m) => m.userId === userId)) {
      throw new HttpError(403, { error: "Forbidden" });
    }

    const messages = await prisma.conversationMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { id: true, name: true, role: true } } },
    });

    return res.json(messages);
  }),
);

conversationsRouter.post(
  "/:id/messages",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = messageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const userId = req.user!.id;
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: { members: true },
    });

    if (!conversation) {
      throw new HttpError(404, { error: "Conversation not found" });
    }

    const access = await requireEventAccess(userId, conversation.eventId);

    if (conversation.type !== "EVENT" && !conversation.members.some((m) => m.userId === userId)) {
      throw new HttpError(403, { error: "Forbidden" });
    }

    const message = await prisma.conversationMessage.create({
      data: {
        conversationId: conversation.id,
        userId,
        body: parsed.data.body,
      },
      include: { user: { select: { id: true, name: true, role: true } } },
    });

    await awardEngagementPoints(userId, POINTS.MESSAGE);

    try {
      if (conversation.type === "EVENT" && access.canManageEvent) {
        const memberUserIds = await allAttendeeUserIds(conversation.eventId);
        await notifyNewMessage({
          eventId: conversation.eventId,
          conversationId: conversation.id,
          senderId: userId,
          senderName: message.user.name,
          preview: parsed.data.body,
          memberUserIds,
          title: `Event-wide · ${message.user.name}`,
        });
      } else if (conversation.type === "DIRECT" || conversation.type === "GROUP") {
        const memberUserIds = conversation.members.map((m) => m.userId);
        await notifyNewMessage({
          eventId: conversation.eventId,
          conversationId: conversation.id,
          senderId: userId,
          senderName: message.user.name,
          preview: parsed.data.body,
          memberUserIds,
        });
      }
    } catch (err) {
      console.error("notifyNewMessage failed:", err);
    }

    return res.json(message);
  }),
);

conversationsRouter.patch(
  "/:id/messages/:messageId",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = messageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const userId = req.user!.id;
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: { members: true },
    });
    if (!conversation) throw new HttpError(404, { error: "Conversation not found" });

    const access = await requireEventAccess(userId, conversation.eventId);
    if (conversation.type !== "EVENT" && !conversation.members.some((m) => m.userId === userId)) {
      throw new HttpError(403, { error: "Forbidden" });
    }

    const message = await prisma.conversationMessage.findFirst({
      where: { id: req.params.messageId, conversationId: conversation.id },
    });
    if (!message) throw new HttpError(404, { error: "Message not found" });

    const canEdit = access.canManageEvent || message.userId === userId;
    if (!canEdit) throw new HttpError(403, { error: "Forbidden" });

    const updated = await prisma.conversationMessage.update({
      where: { id: message.id },
      data: { body: parsed.data.body },
      include: { user: { select: { id: true, name: true, role: true } } },
    });
    return res.json(updated);
  }),
);

conversationsRouter.delete(
  "/:id/messages/:messageId",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const userId = req.user!.id;
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: { members: true },
    });
    if (!conversation) throw new HttpError(404, { error: "Conversation not found" });

    const access = await requireEventAccess(userId, conversation.eventId);
    if (conversation.type !== "EVENT" && !conversation.members.some((m) => m.userId === userId)) {
      throw new HttpError(403, { error: "Forbidden" });
    }

    const message = await prisma.conversationMessage.findFirst({
      where: { id: req.params.messageId, conversationId: conversation.id },
    });
    if (!message) throw new HttpError(404, { error: "Message not found" });

    const canDelete = access.canManageEvent || message.userId === userId;
    if (!canDelete) throw new HttpError(403, { error: "Forbidden" });

    await prisma.conversationMessage.delete({ where: { id: message.id } });
    return res.json({ ok: true });
  }),
);

