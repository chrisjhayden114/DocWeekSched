import { prisma } from "./db";

export async function getOrCreateEvent() {
  const existing = await prisma.event.findFirst();
  if (existing) return existing;

  return prisma.event.create({
    data: {
      name: "My Event",
      timezone: "America/New_York",
      startDate: new Date(),
      endDate: new Date(),
    },
  });
}
