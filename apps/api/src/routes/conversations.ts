import { Router } from "express";
import { z } from "zod";
import { asyncHandler, HttpError, requireEventAccess } from "../lib/authorization";
import { prisma } from "../lib/db";
import { getDirectConversation } from "../lib/conversations";
import { allAttendeeUserIds, notifyNewMessage } from "../lib/notifications";
import { resolveEventFromRequest } from "../lib/requestEvent";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";
import { featureEnabled, requireFeature } from "../lib/features";
import {
  firstMessageTooLong,
  promotesOnSend,
  REQUEST_FIRST_MESSAGE_MAX,
  requestSendDecision,
  withinRequestCaps,
} from "../lib/requestGate";
import { assertMutuallyVisible, isBlockedBetween } from "../lib/visibility";
import { authorOrDeleted } from "../lib/authorDisplay";
import { validationErrorBody } from "../lib/errors";
import { parsePagination, setPageHeaders, slicePage } from "../lib/pagination";

export const conversationsRouter = Router();

const createGroupSchema = z.object({
  name: z.string().min(1),
  memberIds: z.array(z.string()).min(1),
});

const createDirectSchema = z.object({
  userId: z.string().min(1),
  /** M8: optional session this DM is about (context chip). Ignored if invalid. */
  contextSessionId: z.string().optional(),
});

const messageSchema = z.object({
  body: z.string().min(1),
});

const muteSchema = z.object({
  muted: z.boolean(),
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

async function assertNotMessagingSuspended(eventId: string, userId: string) {
  const m = await prisma.eventMembership.findFirst({
    where: { eventId, userId, deletedAt: null },
    select: { messagingSuspendedAt: true },
  });
  if (m?.messagingSuspendedAt) {
    throw new HttpError(403, { error: "Messaging isn't available for your account at this event." });
  }
}

conversationsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const userId = req.user!.id;
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(userId, event.id);
    const { take, cursor } = parsePagination(req.query);

    const { featureEnabled } = await import("../lib/features");
    const allowedTypes: Array<"EVENT" | "DIRECT" | "GROUP"> = [];
    if (await featureEnabled(event.id, "messaging_event_chat")) allowedTypes.push("EVENT");
    if (await featureEnabled(event.id, "messaging_dms")) allowedTypes.push("DIRECT");
    if (await featureEnabled(event.id, "messaging_groups")) allowedTypes.push("GROUP");
    if (allowedTypes.length === 0) {
      setPageHeaders(res, { nextCursor: null, hasMore: false });
      return res.json([]);
    }

    const conversations = await prisma.conversation.findMany({
      where: {
        eventId: event.id,
        type: { in: allowedTypes },
        OR: [{ type: "EVENT" }, { members: { some: { userId } } }],
      },
      include: {
        // affiliation/photoUrl feed the conversation rows on the Messages
        // surface (E18.2) — display fields only, never contact details.
        members: {
          select: {
            userId: true,
            lastReadAt: true,
            mutedAt: true,
            user: { select: { id: true, name: true, role: true, affiliation: true, photoUrl: true } },
          },
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { user: { select: { id: true, name: true } } },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: take + 1,
    });

    const page = slicePage(conversations, take);
    setPageHeaders(res, page);

    const blocks = await prisma.userBlock.findMany({
      where: { eventId: event.id, OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true },
    });
    const blockedOthers = new Set(blocks.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId)));

    // An empty request shouldn't appear for its recipient (M4b).
    const items = page.items.filter(
      (item) =>
        !(item.status === "REQUESTED" && item.initiatedById !== userId && item.messages.length === 0),
    );

    const [eventPref, globalPref] = await Promise.all([
      prisma.notificationPreference.findFirst({ where: { userId, eventId: event.id } }),
      prisma.notificationPreference.findFirst({ where: { userId, eventId: null } }),
    ]);
    const viewerReadReceipts = (eventPref || globalPref)?.readReceipts ?? false;

    const otherPrefByUserId = new Map<string, { readReceipts: boolean }>();
    if (viewerReadReceipts) {
      const otherUserIds = [
        ...new Set(
          items
            .filter((item) => item.type === "DIRECT")
            .map((item) => item.members.find((m) => m.userId !== userId)?.userId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      if (otherUserIds.length > 0) {
        const otherPrefs = await prisma.notificationPreference.findMany({
          where: { userId: { in: otherUserIds }, OR: [{ eventId: event.id }, { eventId: null }] },
          select: { userId: true, eventId: true, readReceipts: true },
        });
        for (const p of otherPrefs) {
          const current = otherPrefByUserId.get(p.userId);
          if (!current || p.eventId === event.id) {
            otherPrefByUserId.set(p.userId, { readReceipts: p.readReceipts });
          }
        }
      }
    }

    // M8: batch-load session titles for context chips (one query).
    const contextSessionIds = [
      ...new Set(items.map((item) => item.contextSessionId).filter((id): id is string => Boolean(id))),
    ];
    const contextSessions =
      contextSessionIds.length > 0
        ? await prisma.session.findMany({
            where: { id: { in: contextSessionIds } },
            select: { id: true, title: true },
          })
        : [];
    const contextSessionById = new Map(contextSessions.map((s) => [s.id, s]));

    return res.json(
      items.map((item) => {
        const viewerMember = item.members.find((m) => m.userId === userId);
        const lastMessage = item.messages[0];
        const muted = !!viewerMember?.mutedAt;
        const unread =
          item.status !== "REQUESTED" &&
          !!lastMessage &&
          lastMessage.user?.id !== userId &&
          (!viewerMember?.lastReadAt ||
            new Date(lastMessage.createdAt) > new Date(viewerMember.lastReadAt)) &&
          !muted;
        const otherId = item.type === "DIRECT" ? item.members.find((m) => m.userId !== userId)?.userId : null;
        const blocked = !!otherId && blockedOthers.has(otherId);
        const otherMemberRow = item.type === "DIRECT" ? item.members.find((m) => m.userId !== userId) : undefined;
        const otherPref = otherMemberRow ? otherPrefByUserId.get(otherMemberRow.userId) : undefined;
        const otherLastReadAt =
          viewerReadReceipts && item.type === "DIRECT" && otherPref?.readReceipts
            ? (otherMemberRow?.lastReadAt?.toISOString() ?? null)
            : null;
        const contextSession = item.contextSessionId
          ? (contextSessionById.get(item.contextSessionId) ?? null)
          : null;
        return {
          ...item,
          unread,
          muted,
          blocked,
          status: item.status,
          initiatedByMe: item.initiatedById === userId,
          otherLastReadAt,
          contextSession,
          members: item.members.map((m) => ({ user: m.user })),
        };
      }),
    );
  }),
);

conversationsRouter.post(
  "/direct",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = createDirectSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(validationErrorBody(parsed.error));
    }

    const userId = req.user!.id;
    const otherUserId = parsed.data.userId;
    const event = await resolveEventFromRequest(req);
    const access = await requireEventAccess(userId, event.id);
    await requireFeature(event.id, "messaging_dms");
    await assertNotMessagingSuspended(event.id, userId);
    await assertEventMembers(event.id, [otherUserId]);

    const visible = await assertMutuallyVisible(event.id, userId, otherUserId);
    if (!visible) {
      throw new HttpError(403, {
        error: "Direct messages require both people to opt into the attendee directory",
      });
    }

    // M8: optional context session — must exist on this event; invalid → null (no error).
    let contextSessionId: string | null = null;
    if (parsed.data.contextSessionId) {
      const ctx = await prisma.session.findFirst({
        where: { id: parsed.data.contextSessionId, eventId: event.id },
        select: { id: true },
      });
      if (ctx) contextSessionId = ctx.id;
    }

    const memberInclude = {
      members: {
        include: {
          user: { select: { id: true, name: true, role: true, affiliation: true, photoUrl: true } },
        },
      },
    } as const;

    const existing = await getDirectConversation(userId, otherUserId, event.id);
    if (existing) {
      // Messaging about a new session refreshes the chip on the existing thread.
      if (contextSessionId) {
        await prisma.conversation.update({
          where: { id: existing.id },
          data: { contextSessionId },
        });
      }
      const full = await prisma.conversation.findUnique({
        where: { id: existing.id },
        include: memberInclude,
      });
      // M8 parity with GET "/": hydrate the context chip immediately.
      const contextSession = full?.contextSessionId
        ? await prisma.session.findUnique({
            where: { id: full.contextSessionId },
            select: { id: true, title: true },
          })
        : null;
      return res.json({ ...full, contextSession });
    }

    // M4b request gate: a stranger's first DM lands as a silent REQUEST.
    // Organizers are exempt; caps are DB-counted (never the in-memory limiter).
    const gateOn = await featureEnabled(event.id, "messaging_requests");
    const isManager = access.canManageEvent;

    // Who-can-message: EXISTING_ONLY/NONE block NEW conversations only.
    // Existing threads returned above; organizer senders exempt like the gate.
    if (!isManager) {
      const targetMembership = await prisma.eventMembership.findFirst({
        where: { eventId: event.id, userId: otherUserId, deletedAt: null },
        select: { messagePolicy: true },
      });
      const policy = targetMembership?.messagePolicy ?? "ANYONE";
      if (policy === "NONE" || policy === "EXISTING_ONLY") {
        throw new HttpError(403, { error: "This person isn't accepting new messages." });
      }
    }
    let status = "ACTIVE";
    if (gateOn && !isManager) {
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [today, eventTotal] = await Promise.all([
        prisma.conversation.count({
          where: { initiatedById: userId, eventId: event.id, createdAt: { gte: dayAgo } },
        }),
        prisma.conversation.count({ where: { initiatedById: userId, eventId: event.id } }),
      ]);
      if (!withinRequestCaps({ today, event: eventTotal })) {
        throw new HttpError(429, {
          error: "You've reached the limit for starting new conversations. Try again tomorrow.",
        });
      }
      status = "REQUESTED";
    }

    const conversation = await prisma.conversation.create({
      data: {
        eventId: event.id,
        type: "DIRECT",
        status,
        initiatedById: userId,
        contextSessionId,
        members: {
          create: [{ userId }, { userId: otherUserId }],
        },
      },
      include: memberInclude,
    });

    // M8 parity with GET "/": hydrate the context chip immediately.
    const contextSession = conversation.contextSessionId
      ? await prisma.session.findUnique({
          where: { id: conversation.contextSessionId },
          select: { id: true, title: true },
        })
      : null;
    return res.json({ ...conversation, contextSession });
  }),
);

conversationsRouter.post(
  "/group",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = createGroupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(validationErrorBody(parsed.error));
    }

    const userId = req.user!.id;
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(userId, event.id);
    await requireFeature(event.id, "messaging_groups");

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
      include: {
        members: {
          include: {
            user: { select: { id: true, name: true, role: true, affiliation: true, photoUrl: true } },
          },
        },
      },
    });

    return res.json(conversation);
  }),
);

conversationsRouter.post(
  "/read-all",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const userId = req.user!.id;
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(userId, event.id);

    await prisma.conversationMember.updateMany({
      where: { userId, conversation: { eventId: event.id } },
      data: { lastReadAt: new Date() },
    });

    return res.json({ ok: true });
  }),
);

conversationsRouter.post(
  "/:id/read",
  requireAuth,
  requireCsrf,
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
    if (!conversation.members.some((m) => m.userId === userId)) {
      throw new HttpError(403, { error: "Forbidden" });
    }

    await prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId: conversation.id, userId } },
      data: { lastReadAt: new Date() },
    });

    return res.json({ ok: true });
  }),
);

conversationsRouter.post(
  "/:id/mute",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = muteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(validationErrorBody(parsed.error));
    }

    const userId = req.user!.id;
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: { members: true },
    });
    if (!conversation) {
      throw new HttpError(404, { error: "Conversation not found" });
    }
    await requireEventAccess(userId, conversation.eventId);
    if (!conversation.members.some((m) => m.userId === userId)) {
      throw new HttpError(403, { error: "Forbidden" });
    }

    const muted = parsed.data.muted;
    await prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId: conversation.id, userId } },
      data: { mutedAt: muted ? new Date() : null },
    });

    return res.json({ muted });
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

    if (conversation.type === "EVENT") {
      await requireFeature(conversation.eventId, "messaging_event_chat");
    } else if (conversation.type === "DIRECT") {
      await requireFeature(conversation.eventId, "messaging_dms");
    } else if (conversation.type === "GROUP") {
      await requireFeature(conversation.eventId, "messaging_groups");
    }

    if (conversation.type !== "EVENT" && !conversation.members.some((m) => m.userId === userId)) {
      throw new HttpError(403, { error: "Forbidden" });
    }

    const { take, cursor } = parsePagination(req.query);
    const messages = await prisma.conversationMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: take + 1,
      include: { user: { select: { id: true, name: true, role: true } } },
    });

    const mapped = messages.map((m) => ({
      ...m,
      user: authorOrDeleted(m.user),
    }));
    const page = slicePage(mapped, take);
    setPageHeaders(res, page);
    return res.json(page.items);
  }),
);

conversationsRouter.post(
  "/:id/messages",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = messageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(validationErrorBody(parsed.error));
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

    if (conversation.type === "EVENT") {
      await requireFeature(conversation.eventId, "messaging_event_chat");
    } else if (conversation.type === "DIRECT") {
      await requireFeature(conversation.eventId, "messaging_dms");
    } else if (conversation.type === "GROUP") {
      await requireFeature(conversation.eventId, "messaging_groups");
    }

    if (conversation.type !== "EVENT" && !conversation.members.some((m) => m.userId === userId)) {
      throw new HttpError(403, { error: "Forbidden" });
    }

    await assertNotMessagingSuspended(conversation.eventId, userId);

    if (conversation.type === "DIRECT") {
      const other = conversation.members.find((m) => m.userId !== userId);
      if (other && (await isBlockedBetween(conversation.eventId, userId, other.userId))) {
        throw new HttpError(403, { error: "You can't send messages to this person." });
      }
    }

    // M4b request gate: the initiator gets one (capped) message until the
    // recipient replies; a reply from anyone else accepts the request.
    if (conversation.type === "DIRECT") {
      const senderMessageCount = await prisma.conversationMessage.count({
        where: { conversationId: conversation.id, userId },
      });
      const decision = requestSendDecision(conversation, userId, senderMessageCount);
      if (!decision.allowed) {
        throw new HttpError(403, {
          error: "Waiting for a reply. You can send another message once they respond.",
        });
      }
      if (firstMessageTooLong(conversation, userId, senderMessageCount, parsed.data.body)) {
        return res
          .status(400)
          .json({ error: `Keep your first message under ${REQUEST_FIRST_MESSAGE_MAX} characters.` });
      }
      if (promotesOnSend(conversation, userId)) {
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { status: "ACTIVE" },
        });
        conversation.status = "ACTIVE";
      }
    }

    const message = await prisma.conversationMessage.create({
      data: {
        conversationId: conversation.id,
        userId,
        body: parsed.data.body,
      },
      include: { user: { select: { id: true, name: true, role: true } } },
    });

    try {
      if (conversation.type === "EVENT" && access.canManageEvent) {
        const memberUserIds = await allAttendeeUserIds(conversation.eventId);
        await notifyNewMessage({
          eventId: conversation.eventId,
          conversationId: conversation.id,
          senderId: userId,
          senderName: message.user?.name ?? "Deleted participant",
          preview: parsed.data.body,
          memberUserIds,
          title: `Event-wide · ${message.user?.name ?? "Deleted participant"}`,
        });
      } else if (
        (conversation.type === "DIRECT" || conversation.type === "GROUP") &&
        // Requests are silent — no notification until the recipient accepts.
        conversation.status !== "REQUESTED"
      ) {
        const memberUserIds = conversation.members.map((m) => m.userId);
        await notifyNewMessage({
          eventId: conversation.eventId,
          conversationId: conversation.id,
          senderId: userId,
          senderName: message.user?.name ?? "Deleted participant",
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
      return res.status(400).json(validationErrorBody(parsed.error));
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

