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
