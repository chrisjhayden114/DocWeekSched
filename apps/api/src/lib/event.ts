import { prisma } from "./db";
import { ensureUniqueEventSlug, slugifyEventBase } from "./slug";

export async function getOrCreateEvent() {
  const existing = await prisma.event.findFirst();
  if (existing) return existing;

  const name = "My Event";
  const slug = await ensureUniqueEventSlug(slugifyEventBase(name));
  return prisma.event.create({
    data: {
      name,
      slug,
      timezone: "America/New_York",
      startDate: new Date(),
      endDate: new Date(),
    },
  });
}

/**
 * When the client does not send `x-event-id` (e.g. user opened the root site instead of `/e/{slug}`),
 * avoid `findFirst()` (arbitrary row order). Prefer the event with the most sessions (usually the live
 * conference), then the newest `startDate` as a tiebreaker.
 */
export async function getDefaultEventWhenUnspecified() {
  const events = await prisma.event.findMany({
    orderBy: { startDate: "desc" },
    include: { _count: { select: { sessions: true } } },
  });
  if (events.length === 0) {
    return getOrCreateEvent();
  }
  const ranked = [...events].sort((a, b) => {
    const diff = b._count.sessions - a._count.sessions;
    if (diff !== 0) return diff;
    return b.startDate.getTime() - a.startDate.getTime();
  });
  const best = ranked[0];
  const full = await prisma.event.findUnique({ where: { id: best.id } });
  return full ?? getOrCreateEvent();
}
