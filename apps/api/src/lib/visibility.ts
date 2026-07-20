import { prisma } from "./db";

/** Both members opted into the event directory and neither has blocked the other. */
export async function assertMutuallyVisible(eventId: string, userA: string, userB: string): Promise<boolean> {
  if (userA === userB) return true;
  const [a, b, block] = await Promise.all([
    prisma.eventMembership.findFirst({
      where: { eventId, userId: userA, deletedAt: null },
      select: { directoryOptIn: true },
    }),
    prisma.eventMembership.findFirst({
      where: { eventId, userId: userB, deletedAt: null },
      select: { directoryOptIn: true },
    }),
    prisma.userBlock.findFirst({
      where: {
        eventId,
        OR: [
          { blockerId: userA, blockedId: userB },
          { blockerId: userB, blockedId: userA },
        ],
      },
    }),
  ]);
  if (!a?.directoryOptIn || !b?.directoryOptIn) return false;
  if (block) return false;
  return true;
}
