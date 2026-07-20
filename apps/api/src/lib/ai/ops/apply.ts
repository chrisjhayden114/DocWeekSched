import {
  AnnouncementAudience,
  ModerationReportStatus,
  NotificationKind,
  type OpsInboxCard,
  type Prisma,
} from "@prisma/client";
import { HttpError } from "../../authorization";
import { getDirectConversation } from "../../conversations";
import { prisma } from "../../db";
import { notifyMany, notifyNewMessage } from "../../notifications";
import { writeAuditLog } from "../audit";

function asRecord(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

async function resolveSessionJoinerIds(sessionId: string): Promise<string[]> {
  const rows = await prisma.sessionAttendance.findMany({
    where: { sessionId, status: "JOINING" },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

async function sendAnnouncementFromCard(input: {
  card: OpsInboxCard;
  actorUserId: string;
  eventId: string;
  sessionId: string | null;
  sameDaySessionChange?: boolean;
  notificationKind?: NotificationKind;
}): Promise<{ announcementId: string; recipientCount: number; degradedCount: number }> {
  const recipientIds = input.sessionId
    ? await resolveSessionJoinerIds(input.sessionId)
    : [];
  if (recipientIds.length === 0) {
    throw new HttpError(400, { error: "No session joiners to notify" });
  }

  const announcement = await prisma.announcement.create({
    data: {
      eventId: input.eventId,
      title: input.card.draftTitle.trim(),
      body: input.card.draftBody.trim(),
      createdById: input.actorUserId,
      audience: AnnouncementAudience.SESSION_JOINERS,
      sessionId: input.sessionId,
      publishedAt: new Date(),
      isPreview: false,
      isEmergency: false,
    },
  });

  const kind = input.notificationKind || NotificationKind.ANNOUNCEMENT;
  const { degradedCount } = await notifyMany(
    recipientIds.map((userId) => ({
      userId,
      eventId: input.eventId,
      kind,
      title: announcement.title,
      body: announcement.body.slice(0, 400),
      announcementId: announcement.id,
      sessionId: input.sessionId || undefined,
      sameDaySessionChange: input.sameDaySessionChange,
    })),
  );

  await prisma.announcementAuditLog.create({
    data: {
      announcementId: announcement.id,
      eventId: input.eventId,
      actorId: input.actorUserId,
      action: "PUBLISH",
      payload: {
        recipientCount: recipientIds.length,
        degradedCount,
        source: "ops_inbox",
        opsCardId: input.card.id,
      },
    },
  });

  return {
    announcementId: announcement.id,
    recipientCount: recipientIds.length,
    degradedCount,
  };
}

async function sendDmFromCard(input: {
  card: OpsInboxCard;
  actorUserId: string;
  eventId: string;
  targetUserId: string;
}): Promise<{ conversationId: string; messageId: string }> {
  let conversation = await getDirectConversation(
    input.actorUserId,
    input.targetUserId,
    input.eventId,
  );
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        eventId: input.eventId,
        type: "DIRECT",
        members: {
          create: [{ userId: input.actorUserId }, { userId: input.targetUserId }],
        },
      },
      include: { members: true },
    });
  }

  const body =
    `${input.card.draftTitle.trim()}\n\n${input.card.draftBody.trim()}`.slice(0, 10_000);
  const message = await prisma.conversationMessage.create({
    data: {
      conversationId: conversation.id,
      userId: input.actorUserId,
      body,
    },
  });

  const actor = await prisma.user.findUnique({
    where: { id: input.actorUserId },
    select: { name: true },
  });
  const memberUserIds =
    "members" in conversation && Array.isArray(conversation.members)
      ? conversation.members.map((m: { userId: string }) => m.userId)
      : [input.actorUserId, input.targetUserId];

  await notifyNewMessage({
    eventId: input.eventId,
    conversationId: conversation.id,
    senderId: input.actorUserId,
    senderName: actor?.name || "Organizer",
    preview: body,
    memberUserIds,
  });

  return { conversationId: conversation.id, messageId: message.id };
}

/**
 * Apply/Send an OPEN card. MUST only be called from an authenticated HTTP handler
 * after an explicit organizer click. Detectors and jobs must never call this.
 */
export async function applyOpsCard(input: {
  cardId: string;
  eventId: string;
  actorUserId: string;
}): Promise<{
  card: OpsInboxCard;
  channelRef: string | null;
  result: Record<string, unknown>;
}> {
  const card = await prisma.opsInboxCard.findFirst({
    where: { id: input.cardId, eventId: input.eventId },
  });
  if (!card) throw new HttpError(404, { error: "Ops card not found" });
  if (card.status === "DISMISSED") {
    throw new HttpError(400, { error: "Dismissed cards cannot be applied" });
  }
  if (card.status === "APPLIED") {
    return {
      card,
      channelRef: card.appliedChannelRef,
      result: { alreadyApplied: true },
    };
  }

  const payload = asRecord(card.draftPayload);
  const evidence = asRecord(card.evidence);
  let channelRef: string | null = null;
  let result: Record<string, unknown> = {};

  switch (card.draftActionType) {
    case "ANNOUNCEMENT": {
      const sessionId =
        (typeof payload.sessionId === "string" && payload.sessionId) ||
        (typeof evidence.sessionId === "string" && evidence.sessionId) ||
        null;
      if (!sessionId) throw new HttpError(400, { error: "Announcement card missing sessionId" });
      const kindRaw = payload.notificationKind;
      const notificationKind =
        kindRaw === "SESSION_CHANGED"
          ? NotificationKind.SESSION_CHANGED
          : kindRaw === "SESSION_STARTING_SOON"
            ? NotificationKind.SESSION_STARTING_SOON
            : NotificationKind.ANNOUNCEMENT;
      const sent = await sendAnnouncementFromCard({
        card,
        actorUserId: input.actorUserId,
        eventId: input.eventId,
        sessionId,
        sameDaySessionChange: Boolean(payload.sameDaySessionChange),
        notificationKind,
      });
      channelRef = sent.announcementId;
      result = sent;
      break;
    }
    case "DM":
    case "SPEAKER_NUDGE": {
      let targetUserId =
        typeof payload.targetUserId === "string" ? payload.targetUserId : null;
      if (!targetUserId && card.draftActionType === "DM" && payload.postQaReply) {
        // Post suggested reply on the Q&A thread instead of a DM.
        const threadId = typeof payload.threadId === "string" ? payload.threadId : null;
        if (!threadId) throw new HttpError(400, { error: "Missing threadId for Q&A reply" });
        const reply = await prisma.sessionDiscussionReply.create({
          data: {
            threadId,
            authorId: input.actorUserId,
            body: card.draftBody.trim(),
          },
        });
        await prisma.sessionDiscussionThread.update({
          where: { id: threadId },
          data: { answeredAt: new Date(), answeredById: input.actorUserId },
        });
        channelRef = reply.id;
        result = { replyId: reply.id, threadId };
        break;
      }
      if (!targetUserId) {
        throw new HttpError(400, { error: "DM/nudge card missing targetUserId" });
      }
      const dm = await sendDmFromCard({
        card,
        actorUserId: input.actorUserId,
        eventId: input.eventId,
        targetUserId,
      });
      channelRef = dm.conversationId;
      result = dm;
      break;
    }
    case "ROOM_MOVE": {
      const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : null;
      const roomId = typeof payload.suggestedRoomId === "string" ? payload.suggestedRoomId : null;
      if (!sessionId || !roomId) {
        throw new HttpError(400, { error: "Room move requires sessionId and suggestedRoomId" });
      }
      const room = await prisma.room.findFirst({ where: { id: roomId, eventId: input.eventId } });
      if (!room) throw new HttpError(400, { error: "Suggested room not found on this event" });
      await prisma.session.update({
        where: { id: sessionId },
        data: { roomId },
      });
      channelRef = roomId;
      result = { sessionId, roomId, roomName: room.name };
      break;
    }
    case "OPEN_VIRTUAL": {
      const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : null;
      if (!sessionId) throw new HttpError(400, { error: "Open virtual requires sessionId" });
      await prisma.session.update({
        where: { id: sessionId },
        data: { allowVirtualJoin: true },
      });
      channelRef = sessionId;
      result = { sessionId, allowVirtualJoin: true };
      break;
    }
    case "MODERATION_REVIEW": {
      const reportId = typeof payload.reportId === "string" ? payload.reportId : null;
      if (reportId) {
        await prisma.userReport.updateMany({
          where: { id: reportId, eventId: input.eventId, status: ModerationReportStatus.OPEN },
          data: {
            status: ModerationReportStatus.REVIEWED,
            resolvedAt: new Date(),
            resolverId: input.actorUserId,
          },
        });
        channelRef = reportId;
        result = { reportId, status: "REVIEWED" };
      } else {
        channelRef = null;
        result = { acknowledged: true, payload };
      }
      break;
    }
    case "DIGEST_NOTE": {
      channelRef = null;
      result = { acknowledged: true };
      break;
    }
    default:
      throw new HttpError(400, { error: `Unsupported draft action: ${card.draftActionType}` });
  }

  const evidenceSnapshot = {
    evidence,
    draftPayload: payload,
    draftTitle: card.draftTitle,
    draftBody: card.draftBody,
    draftActionType: card.draftActionType,
    appliedResult: result,
    appliedAt: new Date().toISOString(),
  } as Prisma.InputJsonValue;

  const updated = await prisma.opsInboxCard.update({
    where: { id: card.id },
    data: {
      status: "APPLIED",
      appliedAt: new Date(),
      appliedById: input.actorUserId,
      appliedChannelRef: channelRef,
      evidenceSnapshot,
    },
  });

  await writeAuditLog({
    organizationId: card.organizationId,
    eventId: card.eventId,
    actorUserId: input.actorUserId,
    action: "AI_NOTIFY",
    entityType: "OpsInboxCard",
    entityId: card.id,
    aiGenerated: true,
    payload: evidenceSnapshot,
  });

  return { card: updated, channelRef, result };
}
