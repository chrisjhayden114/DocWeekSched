import { prisma } from "./db";
import { getOrCreateEvent } from "./event";

export async function getOrCreateEventConversation() {
  const event = await getOrCreateEvent();
  const existing = await prisma.conversation.findFirst({
    where: { eventId: event.id, type: "EVENT" },
  });
  if (existing) return existing;

  return prisma.conversation.create({
    data: {
      eventId: event.id,
      type: "EVENT",
      name: "Event Chat",
    },
  });
}

export async function getDirectConversation(userId: string, otherUserId: string) {
  const event = await getOrCreateEvent();
  const conversations = await prisma.conversation.findMany({
    where: {
      eventId: event.id,
      type: "DIRECT",
      members: {
        some: {
          userId: { in: [userId, otherUserId] },
        },
      },
    },
    include: { members: true },
  });

  return conversations.find((c) =>
    c.members.length === 2 &&
    c.members.some((m) => m.userId === userId) &&
    c.members.some((m) => m.userId === otherUserId)
  );
}
