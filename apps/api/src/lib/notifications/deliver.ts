import {
  NotificationClass,
  NotificationDelivery,
  NotificationKind,
} from "@prisma/client";
import { prisma } from "../db";
import { sendWebPushToUser } from "../push/webPush";
import { tryChargePushBudget } from "./budget";
import {
  classForKind,
  DEFAULT_PREFS,
  muteCategoryForKind,
  type DeliverInput,
  type DeliverResult,
  type ResolvedPrefs,
} from "./types";
import { isInQuietHours, nextQuietHoursEnd } from "./timezone";

async function maybePush(
  userId: string,
  delivery: NotificationDelivery,
  title: string,
  body?: string | null,
  sessionId?: string | null,
): Promise<void> {
  if (delivery !== NotificationDelivery.PUSHED) return;
  const url = sessionId
    ? `/session/${sessionId}`
    : "/dashboard?tab=Notifications";
  await sendWebPushToUser(userId, { title, body, url }).catch(() => undefined);
}

async function resolvePrefs(userId: string, eventId: string, eventTimezone: string): Promise<ResolvedPrefs> {
  const [eventPref, globalPref] = await Promise.all([
    prisma.notificationPreference.findFirst({ where: { userId, eventId } }),
    prisma.notificationPreference.findFirst({ where: { userId, eventId: null } }),
  ]);
  const row = eventPref || globalPref;
  return {
    quietHoursStart: row?.quietHoursStart ?? DEFAULT_PREFS.quietHoursStart,
    quietHoursEnd: row?.quietHoursEnd ?? DEFAULT_PREFS.quietHoursEnd,
    digestLocalTime: row?.digestLocalTime ?? DEFAULT_PREFS.digestLocalTime,
    digestEmail: row?.digestEmail ?? DEFAULT_PREFS.digestEmail,
    mutedCategories: row?.mutedCategories ?? DEFAULT_PREFS.mutedCategories,
    timezone: row?.timezone || eventTimezone || "UTC",
  };
}

async function loadEventTimezone(eventId: string): Promise<string> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { timezone: true },
  });
  return event?.timezone || "UTC";
}

/**
 * Deliver one notification through the calm platform.
 * DIGEST kinds never push. INTERRUPT may push, queue for quiet hours, or degrade to digest.
 */
export async function deliverNotification(
  input: DeliverInput,
  now = new Date(),
): Promise<DeliverResult> {
  if (input.pushDedupKey) {
    const existing = await prisma.userNotification.findFirst({
      where: { pushDedupKey: input.pushDedupKey },
    });
    if (existing) {
      return {
        notificationId: existing.id,
        class: existing.class,
        delivery: existing.delivery,
        budgetCharged: existing.budgetCharged,
        degradedToDigest: existing.delivery === NotificationDelivery.DIGESTED,
        suppressed: existing.delivery === NotificationDelivery.SUPPRESSED,
      };
    }
  }

  const eventTimezone = await loadEventTimezone(input.eventId);
  const prefs = await resolvePrefs(input.userId, input.eventId, eventTimezone);
  const klass = classForKind(input.kind);

  const muteCat = muteCategoryForKind(input.kind);
  if (muteCat && prefs.mutedCategories.includes(muteCat) && !input.emergency) {
    const row = await prisma.userNotification.create({
      data: {
        userId: input.userId,
        eventId: input.eventId,
        kind: input.kind,
        class: klass,
        delivery: NotificationDelivery.SUPPRESSED,
        title: input.title,
        body: input.body ?? null,
        threadId: input.threadId ?? null,
        conversationId: input.conversationId ?? null,
        announcementId: input.announcementId ?? null,
        meetingRequestId: input.meetingRequestId ?? null,
        sessionId: input.sessionId ?? null,
        pushDedupKey: input.pushDedupKey ?? null,
        budgetCharged: false,
        readAt: now,
      },
    });
    return {
      notificationId: row.id,
      class: klass,
      delivery: NotificationDelivery.SUPPRESSED,
      budgetCharged: false,
      degradedToDigest: false,
      suppressed: true,
    };
  }

  if (klass === NotificationClass.DIGEST) {
    const row = await prisma.userNotification.create({
      data: {
        userId: input.userId,
        eventId: input.eventId,
        kind: input.kind,
        class: NotificationClass.DIGEST,
        delivery: NotificationDelivery.INBOX,
        title: input.title,
        body: input.body ?? null,
        threadId: input.threadId ?? null,
        conversationId: input.conversationId ?? null,
        announcementId: input.announcementId ?? null,
        meetingRequestId: input.meetingRequestId ?? null,
        sessionId: input.sessionId ?? null,
        pushDedupKey: input.pushDedupKey ?? null,
        budgetCharged: false,
      },
    });
    return {
      notificationId: row.id,
      class: NotificationClass.DIGEST,
      delivery: NotificationDelivery.INBOX,
      budgetCharged: false,
      degradedToDigest: false,
      suppressed: false,
    };
  }

  // INTERRUPT
  if (input.emergency) {
    const row = await prisma.userNotification.create({
      data: {
        userId: input.userId,
        eventId: input.eventId,
        kind: input.kind,
        class: NotificationClass.INTERRUPT,
        delivery: NotificationDelivery.PUSHED,
        title: input.title,
        body: input.body ?? null,
        threadId: input.threadId ?? null,
        conversationId: input.conversationId ?? null,
        announcementId: input.announcementId ?? null,
        meetingRequestId: input.meetingRequestId ?? null,
        sessionId: input.sessionId ?? null,
        pushDedupKey: input.pushDedupKey ?? null,
        budgetCharged: false,
      },
    });
    await maybePush(input.userId, NotificationDelivery.PUSHED, input.title, input.body, input.sessionId);
    return {
      notificationId: row.id,
      class: NotificationClass.INTERRUPT,
      delivery: NotificationDelivery.PUSHED,
      budgetCharged: false,
      degradedToDigest: false,
      suppressed: false,
    };
  }

  const bypassQuiet = Boolean(input.sameDaySessionChange);
  const inQuiet =
    !bypassQuiet &&
    isInQuietHours(now, prefs.timezone, prefs.quietHoursStart, prefs.quietHoursEnd);

  if (inQuiet) {
    const queuedUntil =
      nextQuietHoursEnd(now, prefs.timezone, prefs.quietHoursStart, prefs.quietHoursEnd) ||
      new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const row = await prisma.userNotification.create({
      data: {
        userId: input.userId,
        eventId: input.eventId,
        kind: input.kind,
        class: NotificationClass.INTERRUPT,
        delivery: NotificationDelivery.QUEUED_PUSH,
        queuedUntil,
        title: input.title,
        body: input.body ?? null,
        threadId: input.threadId ?? null,
        conversationId: input.conversationId ?? null,
        announcementId: input.announcementId ?? null,
        meetingRequestId: input.meetingRequestId ?? null,
        sessionId: input.sessionId ?? null,
        pushDedupKey: input.pushDedupKey ?? null,
        budgetCharged: false,
      },
    });
    return {
      notificationId: row.id,
      class: NotificationClass.INTERRUPT,
      delivery: NotificationDelivery.QUEUED_PUSH,
      budgetCharged: false,
      degradedToDigest: false,
      suppressed: false,
    };
  }

  const { charged, status } = await tryChargePushBudget(input.userId, prefs.timezone, now);
  if (!charged) {
    const row = await prisma.userNotification.create({
      data: {
        userId: input.userId,
        eventId: input.eventId,
        kind: input.kind,
        class: NotificationClass.INTERRUPT,
        delivery: NotificationDelivery.DIGESTED,
        title: input.title,
        body: input.body ?? null,
        threadId: input.threadId ?? null,
        conversationId: input.conversationId ?? null,
        announcementId: input.announcementId ?? null,
        meetingRequestId: input.meetingRequestId ?? null,
        sessionId: input.sessionId ?? null,
        pushDedupKey: input.pushDedupKey ?? null,
        budgetCharged: false,
      },
    });
    return {
      notificationId: row.id,
      class: NotificationClass.INTERRUPT,
      delivery: NotificationDelivery.DIGESTED,
      budgetCharged: false,
      degradedToDigest: true,
      suppressed: false,
    };
  }

  const row = await prisma.userNotification.create({
    data: {
      userId: input.userId,
      eventId: input.eventId,
      kind: input.kind,
      class: NotificationClass.INTERRUPT,
      delivery: NotificationDelivery.PUSHED,
      title: input.title,
      body: input.body ?? null,
      threadId: input.threadId ?? null,
      conversationId: input.conversationId ?? null,
      announcementId: input.announcementId ?? null,
      meetingRequestId: input.meetingRequestId ?? null,
      sessionId: input.sessionId ?? null,
      pushDedupKey: input.pushDedupKey ?? null,
      budgetCharged: true,
    },
  });
  await maybePush(input.userId, NotificationDelivery.PUSHED, input.title, input.body, input.sessionId);
  return {
    notificationId: row.id,
    class: NotificationClass.INTERRUPT,
    delivery: NotificationDelivery.PUSHED,
    budgetCharged: true,
    degradedToDigest: false,
    suppressed: false,
  };
}

export type NotifyManyRow = {
  userId: string;
  eventId: string;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  threadId?: string | null;
  conversationId?: string | null;
  announcementId?: string | null;
  meetingRequestId?: string | null;
  sessionId?: string | null;
  emergency?: boolean;
  sameDaySessionChange?: boolean;
  pushDedupKey?: string | null;
};

export async function notifyMany(rows: NotifyManyRow[], now = new Date()): Promise<{
  results: DeliverResult[];
  degradedCount: number;
}> {
  const results: DeliverResult[] = [];
  for (const row of rows) {
    results.push(await deliverNotification(row, now));
  }
  return {
    results,
    degradedCount: results.filter((r) => r.degradedToDigest).length,
  };
}

/** Flush quiet-hour queue whose queuedUntil has passed — charge budget or digest. */
export async function flushQueuedPushes(now = new Date()): Promise<number> {
  const due = await prisma.userNotification.findMany({
    where: {
      delivery: NotificationDelivery.QUEUED_PUSH,
      queuedUntil: { lte: now },
    },
    take: 200,
  });
  let flushed = 0;
  for (const n of due) {
    if (!n.eventId) continue;
    const eventTimezone = await loadEventTimezone(n.eventId);
    const prefs = await resolvePrefs(n.userId, n.eventId, eventTimezone);
    const { charged } = await tryChargePushBudget(n.userId, prefs.timezone, now);
    await prisma.userNotification.update({
      where: { id: n.id },
      data: charged
        ? { delivery: NotificationDelivery.PUSHED, budgetCharged: true, queuedUntil: null }
        : { delivery: NotificationDelivery.DIGESTED, budgetCharged: false, queuedUntil: null },
    });
    if (charged) {
      await maybePush(n.userId, NotificationDelivery.PUSHED, n.title, n.body, n.sessionId);
    }
    flushed += 1;
  }
  return flushed;
}
