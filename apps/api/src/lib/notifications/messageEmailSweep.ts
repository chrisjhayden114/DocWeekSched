import {
  NotificationClass,
  NotificationDelivery,
  NotificationKind,
} from "@prisma/client";
import { prisma } from "../db";
import { sendUnreadMessagesEmail } from "../mail";
import { DEFAULT_PREFS } from "./types";
import { isInQuietHours, localDayKey } from "./timezone";
import { emailEligibleDms, messageEmailDedupKey, type UnreadDm } from "./messageEmailRules";

function webBase(): string {
  return (process.env.WEB_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
}

function senderNameFromTitle(title: string): string {
  const prefix = "Message from ";
  return title.startsWith(prefix) ? title.slice(prefix.length) : title;
}

function previewLine(senderName: string, preview: string): string {
  const clipped = preview.length > 120 ? `${preview.slice(0, 120)}…` : preview;
  return `${senderName}: ${clipped}`;
}

/**
 * Email people who have unread DMs (max one email per user/event/local day).
 * Quiet-hours aware; never for requests, muted threads, or own messages.
 */
export async function sweepUnreadMessageEmails(now = new Date()): Promise<{ sent: number }> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const candidates = await prisma.userNotification.findMany({
    where: {
      kind: NotificationKind.MESSAGE,
      readAt: null,
      createdAt: { gte: since },
      eventId: { not: null },
    },
    distinct: ["userId", "eventId"],
    select: { userId: true, eventId: true },
  });

  let sent = 0;
  for (const pair of candidates) {
    const eventId = pair.eventId;
    if (!eventId) continue;
    const { userId } = pair;

    const [event, user, eventPref, globalPref] = await Promise.all([
      prisma.event.findUnique({
        where: { id: eventId },
        select: { timezone: true, name: true },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, name: true },
      }),
      prisma.notificationPreference.findFirst({ where: { userId, eventId } }),
      prisma.notificationPreference.findFirst({ where: { userId, eventId: null } }),
    ]);
    if (!event || !user?.email) continue;

    const row = eventPref || globalPref;
    const messageEmail = row?.messageEmail ?? true;
    if (messageEmail === false) continue;

    const tz = row?.timezone || event.timezone || "UTC";
    const quietHoursStart = row?.quietHoursStart ?? DEFAULT_PREFS.quietHoursStart;
    const quietHoursEnd = row?.quietHoursEnd ?? DEFAULT_PREFS.quietHoursEnd;
    if (isInQuietHours(now, tz, quietHoursStart, quietHoursEnd)) continue;

    const dayKey = localDayKey(now, tz);
    const dedup = messageEmailDedupKey(userId, eventId, dayKey);
    const existing = await prisma.userNotification.findFirst({
      where: { pushDedupKey: dedup },
    });
    if (existing) continue;

    const notifs = await prisma.userNotification.findMany({
      where: {
        userId,
        eventId,
        kind: NotificationKind.MESSAGE,
        readAt: null,
      },
      select: {
        conversationId: true,
        title: true,
        body: true,
        createdAt: true,
      },
    });
    const convIds = [
      ...new Set(notifs.map((n) => n.conversationId).filter((id): id is string => Boolean(id))),
    ];
    const conversations =
      convIds.length === 0
        ? []
        : await prisma.conversation.findMany({
            where: { id: { in: convIds } },
            select: {
              id: true,
              status: true,
              members: {
                where: { userId },
                select: { mutedAt: true },
              },
            },
          });
    const convById = new Map(conversations.map((c) => [c.id, c]));

    const unreadRows: UnreadDm[] = [];
    for (const n of notifs) {
      if (!n.conversationId) continue;
      const conv = convById.get(n.conversationId);
      if (!conv) continue;
      unreadRows.push({
        conversationId: n.conversationId,
        senderName: senderNameFromTitle(n.title),
        preview: n.body ?? "",
        createdAt: n.createdAt,
        conversationStatus: conv.status,
        muted: Boolean(conv.members[0]?.mutedAt),
        fromSelf: false,
      });
    }

    const eligible = emailEligibleDms(unreadRows, now);
    if (eligible.length === 0) continue;

    const count = eligible.length;
    const lines = eligible.slice(0, 5).map((r) => previewLine(r.senderName, r.preview));
    const dashboardUrl = `${webBase()}/dashboard?tab=Messages`;

    await sendUnreadMessagesEmail({
      to: user.email,
      name: user.name,
      eventName: event.name,
      count,
      lines,
      dashboardUrl,
    });

    await prisma.userNotification.create({
      data: {
        userId,
        eventId,
        kind: NotificationKind.DIGEST_ROLLUP,
        class: NotificationClass.DIGEST,
        delivery: NotificationDelivery.INBOX,
        title: `Emailed you about ${count} unread message${count === 1 ? "" : "s"}`,
        body: "",
        pushDedupKey: dedup,
        budgetCharged: false,
      },
    });
    sent += 1;
  }

  return { sent };
}
