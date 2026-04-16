import { prisma } from "./db";

export async function getOrCreateEventConversation(eventId: string) {
  const existing = await prisma.conversation.findFirst({
    where: { eventId, type: "EVENT" },
  });
  if (existing) return existing;

  return prisma.conversation.create({
    data: {
      eventId,
      type: "EVENT",
      name: "Event Chat",
    },
  });
}

export async function getDirectConversation(userId: string, otherUserId: string, eventId: string) {
  const conversations = await prisma.conversation.findMany({
    where: {
      eventId,
      type: "DIRECT",
      members: {
        some: {
          userId: { in: [userId, otherUserId] },
        },
      },
    },
    include: { members: true },
  });

  return conversations.find(
    (c) =>
      c.members.length === 2 &&
      c.members.some((m) => m.userId === userId) &&
      c.members.some((m) => m.userId === otherUserId)
  );
}

export async function getOrCreateSessionConversation(sessionId: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, eventId: true },
  });
  if (!session) return null;

  const existing = await prisma.conversation.findFirst({
    where: { eventId: session.eventId, type: "SESSION", sessionId: session.id },
  });
  if (existing) return existing;

  return prisma.conversation.create({
    data: {
      eventId: session.eventId,
      type: "SESSION",
      sessionId: session.id,
      name: "Session Conversation",
    },
  });
}
