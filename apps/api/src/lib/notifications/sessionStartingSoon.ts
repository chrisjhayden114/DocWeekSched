import { NotificationKind } from "@prisma/client";
import { prisma } from "../db";
import { deliverNotification } from "./deliver";

/** Window: sessions that start between now+leadMinutes and now+leadMinutes+widthMinutes. */
export function sessionStartingSoonWindow(
  now: Date,
  leadMinutes = 15,
  widthMinutes = 5,
): { from: Date; to: Date } {
  const from = new Date(now.getTime() + leadMinutes * 60_000);
  const to = new Date(from.getTime() + widthMinutes * 60_000);
  return { from, to };
}

/**
 * Notify bookmarkers for sessions starting soon (INTERRUPT, inside push budget via deliver).
 * Dedupes with pushDedupKey so re-runs in the same window do not double-notify.
 */
export async function notifySessionStartingSoon(now = new Date()): Promise<number> {
  const { from, to } = sessionStartingSoonWindow(now);
  const sessions = await prisma.session.findMany({
    where: {
      startsAt: { gte: from, lt: to },
    },
    select: {
      id: true,
      title: true,
      eventId: true,
      startsAt: true,
      bookmarks: { select: { userId: true } },
    },
  });

  let sent = 0;
  for (const session of sessions) {
    const dayKey = session.startsAt.toISOString().slice(0, 13);
    for (const b of session.bookmarks) {
      const result = await deliverNotification({
        userId: b.userId,
        eventId: session.eventId,
        kind: NotificationKind.SESSION_STARTING_SOON,
        title: "Session starting soon",
        body: session.title,
        sessionId: session.id,
        pushDedupKey: `starting-soon:${session.id}:${b.userId}:${dayKey}`,
      });
      if (!result.suppressed) sent += 1;
    }
  }
  return sent;
}
