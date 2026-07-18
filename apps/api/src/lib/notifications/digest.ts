import { NotificationClass, NotificationDelivery, NotificationKind } from "@prisma/client";
import { prisma } from "../db";
import { featureEnabled } from "../features";
import { can } from "../billing/entitlements";
import { getZonedParts, localDayKey, zonedWallTimeToUtc, parseHm } from "./timezone";
import { DEFAULT_PREFS } from "./types";

/**
 * Roll unread DIGEST / DIGESTED items into one DIGEST_ROLLUP for the morning.
 * Email is only attempted when plan allows daily_digest AND prefs.digestEmail.
 */
export async function rollupMorningDigest(params: {
  userId: string;
  eventId: string;
  now?: Date;
}): Promise<{ rollupId: string | null; itemCount: number; emailAllowed: boolean }> {
  const now = params.now ?? new Date();
  const event = await prisma.event.findUnique({
    where: { id: params.eventId },
    select: { timezone: true, organizationId: true, name: true },
  });
  if (!event) return { rollupId: null, itemCount: 0, emailAllowed: false };

  const [eventPref, globalPref] = await Promise.all([
    prisma.notificationPreference.findFirst({ where: { userId: params.userId, eventId: params.eventId } }),
    prisma.notificationPreference.findFirst({ where: { userId: params.userId, eventId: null } }),
  ]);
  const row = eventPref || globalPref;
  const digestHm = row?.digestLocalTime ?? DEFAULT_PREFS.digestLocalTime;
  const tz = row?.timezone || event.timezone || "UTC";
  const digestEmail = row?.digestEmail ?? false;

  const digestOn = await featureEnabled(params.eventId, "daily_digest");
  if (!digestOn) return { rollupId: null, itemCount: 0, emailAllowed: false };

  // Only roll once the local digest time has passed for today and we haven't rolled yet today.
  const p = getZonedParts(now, tz);
  const digestMins = parseHm(digestHm);
  const nowMins = p.hour * 60 + p.minute;
  if (nowMins < digestMins) return { rollupId: null, itemCount: 0, emailAllowed: false };

  const dayKey = localDayKey(now, tz);
  const dedup = `digest:${params.userId}:${params.eventId}:${dayKey}`;
  const existing = await prisma.userNotification.findFirst({
    where: { pushDedupKey: dedup },
  });
  if (existing) return { rollupId: existing.id, itemCount: 0, emailAllowed: false };

  const digestStart = zonedWallTimeToUtc(
    tz,
    p.year,
    p.month,
    p.day,
    Math.floor(digestMins / 60),
    digestMins % 60,
    0,
  );
  // Items since previous digest window (~24h lookback ending at today's digest time)
  const since = new Date(digestStart.getTime() - 24 * 60 * 60 * 1000);

  const items = await prisma.userNotification.findMany({
    where: {
      userId: params.userId,
      eventId: params.eventId,
      readAt: null,
      OR: [
        { class: NotificationClass.DIGEST, delivery: NotificationDelivery.INBOX },
        { delivery: NotificationDelivery.DIGESTED },
      ],
      createdAt: { gte: since, lt: digestStart },
      kind: { not: NotificationKind.DIGEST_ROLLUP },
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });

  if (items.length === 0) return { rollupId: null, itemCount: 0, emailAllowed: false };

  const lines = items.map((i) => `• ${i.title}`).slice(0, 20);
  const body =
    lines.join("\n") + (items.length > 20 ? `\n…and ${items.length - 20} more` : "");

  const rollup = await prisma.userNotification.create({
    data: {
      userId: params.userId,
      eventId: params.eventId,
      kind: NotificationKind.DIGEST_ROLLUP,
      class: NotificationClass.DIGEST,
      delivery: NotificationDelivery.INBOX,
      title: `Your daily digest — ${event.name}`,
      body,
      pushDedupKey: dedup,
      budgetCharged: false,
    },
  });

  const planAllowsEmail = event.organizationId
    ? await can(event.organizationId, "daily_digest")
    : false;
  const emailAllowed = Boolean(digestEmail && planAllowsEmail);

  return { rollupId: rollup.id, itemCount: items.length, emailAllowed };
}
