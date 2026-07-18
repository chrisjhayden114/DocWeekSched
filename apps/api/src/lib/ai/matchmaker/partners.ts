import { prisma } from "../../db";

/** User ids with an existing DIRECT conversation with `userId` in this event. */
export async function listDirectChatPartnerIds(eventId: string, userId: string): Promise<Set<string>> {
  const conversations = await prisma.conversation.findMany({
    where: {
      eventId,
      type: "DIRECT",
      members: { some: { userId } },
    },
    include: { members: { select: { userId: true } } },
  });

  const partners = new Set<string>();
  for (const c of conversations) {
    if (c.members.length !== 2) continue;
    for (const m of c.members) {
      if (m.userId !== userId) partners.add(m.userId);
    }
  }
  return partners;
}
