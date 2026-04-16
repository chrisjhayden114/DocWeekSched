import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db";
import { getDirectConversation, getOrCreateEventConversation } from "../lib/conversations";
import { awardEngagementPoints, POINTS } from "../lib/points";
import { resolveEventFromRequest } from "../lib/requestEvent";
import { requireAuth, AuthedRequest } from "../lib/middleware";

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

conversationsRouter.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.user?.id || "";
  const event = await resolveEventFromRequest(req);
  await getOrCreateEventConversation(event.id);

  const conversations = await prisma.conversation.findMany({
    where: {
      eventId: event.id,
      OR: [{ type: "EVENT" }, { members: { some: { userId } } }],
    },
    include: {
      members: { include: { user: { select: { id: true, name: true, role: true } } } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, include: { user: { select: { id: true, name: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  return res.json(conversations);
});

conversationsRouter.post("/direct", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = createDirectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const userId = req.user?.id || "";
  const otherUserId = parsed.data.userId;
  const event = await resolveEventFromRequest(req);
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
});

conversationsRouter.post("/group", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = createGroupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const userId = req.user?.id || "";
  const event = await resolveEventFromRequest(req);
  const memberIds = Array.from(new Set([userId, ...parsed.data.memberIds]));

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
});

conversationsRouter.get("/:id/messages", requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.user?.id || "";
  const conversation = await prisma.conversation.findUnique({
    where: { id: req.params.id },
    include: { members: true },
  });

  if (!conversation) {
    return res.status(404).json({ error: "Conversation not found" });
  }

  if (conversation.type !== "EVENT" && !conversation.members.some((m) => m.userId === userId)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const messages = await prisma.conversationMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { id: true, name: true, role: true } } },
  });

  return res.json(messages);
});

conversationsRouter.post("/:id/messages", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const userId = req.user?.id || "";
  const conversation = await prisma.conversation.findUnique({
    where: { id: req.params.id },
    include: { members: true },
  });

  if (!conversation) {
    return res.status(404).json({ error: "Conversation not found" });
  }

  if (conversation.type !== "EVENT" && !conversation.members.some((m) => m.userId === userId)) {
    return res.status(403).json({ error: "Forbidden" });
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
  return res.json(message);
});
