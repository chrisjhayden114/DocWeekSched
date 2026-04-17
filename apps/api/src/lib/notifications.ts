import { NotificationKind, Prisma } from "@prisma/client";
import { prisma } from "./db";

const CHANNEL_LABEL: Record<string, string> = {
  GENERAL: "General",
  MEETUP: "Meet-ups",
  MOMENTS: "Share your moments",
  LOCAL: "Local recommendations",
  ICEBREAKER: "Break the ice",
};

export function communityChannelLabel(channel: string): string {
  return CHANNEL_LABEL[channel] ?? "Community";
}

export async function allAttendeeUserIds(): Promise<string[]> {
  const rows = await prisma.user.findMany({ select: { id: true } });
  return rows.map((r) => r.id);
}

export async function notifyMany(
  rows: Prisma.UserNotificationCreateManyInput[],
): Promise<void> {
  if (rows.length === 0) return;
  await prisma.userNotification.createMany({ data: rows });
}

export async function notifyNewCommunityThread(params: {
  eventId: string;
  threadId: string;
  channel: string;
  title: string;
  authorId: string;
  authorName: string;
  meetupInviteEveryone: boolean;
  meetupParticipantIds: string[];
}): Promise<void> {
  const label = communityChannelLabel(params.channel);
  const title = `${params.authorName} in ${label}`;
  const body = params.title.slice(0, 180);

  let recipientIds: string[];
  if (params.channel === "MEETUP" && !params.meetupInviteEveryone) {
    recipientIds = Array.from(new Set(params.meetupParticipantIds)).filter((id) => id !== params.authorId);
  } else {
    const all = await allAttendeeUserIds();
    recipientIds = all.filter((id) => id !== params.authorId);
  }

  await notifyMany(
    recipientIds.map((userId) => ({
      userId,
      eventId: params.eventId,
      kind: NotificationKind.COMMUNITY_THREAD,
      title,
      body,
      threadId: params.threadId,
    })),
  );

  await notifyMany([
    {
      userId: params.authorId,
      eventId: params.eventId,
      kind: NotificationKind.COMMUNITY_THREAD,
      title: `Your post in ${label}`,
      body,
      threadId: params.threadId,
    },
  ]);
}

export async function notifyCommunityReply(params: {
  eventId: string;
  threadId: string;
  threadTitle: string;
  threadAuthorId: string;
  replierId: string;
  replierName: string;
  replyPreview: string;
  priorReplierIds: string[];
}): Promise<void> {
  const notifySet = new Set<string>([params.threadAuthorId, ...params.priorReplierIds]);
  notifySet.delete(params.replierId);

  const title = `${params.replierName} replied`;
  const body = `"${params.threadTitle.slice(0, 80)}${params.threadTitle.length > 80 ? "…" : ""}" — ${params.replyPreview.slice(0, 120)}`;

  await notifyMany(
    [...notifySet].map((userId) => ({
      userId,
      eventId: params.eventId,
      kind: NotificationKind.COMMUNITY_REPLY,
      title,
      body,
      threadId: params.threadId,
    })),
  );

  await notifyMany([
    {
      userId: params.replierId,
      eventId: params.eventId,
      kind: NotificationKind.COMMUNITY_REPLY,
      title: "Your reply was posted",
      body: params.replyPreview.slice(0, 200),
      threadId: params.threadId,
    },
  ]);
}

export async function notifyNewMessage(params: {
  eventId: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  preview: string;
  memberUserIds: string[];
  /** When set (e.g. event-wide organizer broadcast), used instead of "Message from …". */
  title?: string;
}): Promise<void> {
  const recipients = params.memberUserIds.filter((id) => id !== params.senderId);
  const title = params.title ?? `Message from ${params.senderName}`;
  const body = params.preview.slice(0, 200);

  await notifyMany(
    recipients.map((userId) => ({
      userId,
      eventId: params.eventId,
      kind: NotificationKind.MESSAGE,
      title,
      body,
      conversationId: params.conversationId,
    })),
  );
}
