import { NotificationClass, NotificationDelivery, NotificationKind } from "@prisma/client";
import { prisma } from "../db";
import { log } from "../log";
import { rollupMorningDigest } from "./digest";

/**
 * Periodic sweep: find user/event pairs with unread digest-eligible items and
 * ask rollupMorningDigest() to roll them up. In-app only — digestEmail has no
 * UI or template yet, so the emailAllowed result is intentionally ignored.
 *
 * rollupMorningDigest() already short-circuits on the daily_digest flag, the
 * local digest time not having passed yet, an existing rollup for today, or
 * no eligible items — this sweep does not duplicate those checks.
 */
export async function sweepDailyDigests(now = new Date()): Promise<{ rolled: number }> {
  const candidates = await prisma.userNotification.findMany({
    where: {
      readAt: null,
      eventId: { not: null },
      createdAt: { gte: new Date(now.getTime() - 48 * 60 * 60 * 1000) },
      kind: { not: NotificationKind.DIGEST_ROLLUP },
      OR: [
        { class: NotificationClass.DIGEST, delivery: NotificationDelivery.INBOX },
        { delivery: NotificationDelivery.DIGESTED },
      ],
    },
    distinct: ["userId", "eventId"],
    select: { userId: true, eventId: true },
  });

  let rolled = 0;
  for (const pair of candidates) {
    const eventId = pair.eventId;
    if (!eventId) continue;
    try {
      const r = await rollupMorningDigest({ userId: pair.userId, eventId, now });
      if (r.rollupId && r.itemCount > 0) rolled += 1;
    } catch (err) {
      log("warn", "sweepDailyDigests: rollup failed for pair", {
        userId: pair.userId,
        eventId,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { rolled };
}
