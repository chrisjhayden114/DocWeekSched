import { prisma } from "./db";

/**
 * Both members opted into the event directory and neither has blocked the other.
 * Blocks are account-wide (BLOCK-W): a UserBlock between two people applies across
 * every event; eventId on the row is provenance of where the block was created.
 */
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

/**
 * Whether either user has blocked the other. Blocks are account-wide as of BLOCK-W.
 * eventId retained in the signature for call-site compatibility; blocks are account-wide as of BLOCK-W.
 */
export async function isBlockedBetween(eventId: string, userA: string, userB: string): Promise<boolean> {
  void eventId;
  if (userA === userB) return false;
  const block = await prisma.userBlock.findFirst({
    where: {
      OR: [
        { blockerId: userA, blockedId: userB },
        { blockerId: userB, blockedId: userA },
      ],
    },
  });
  return !!block;
}
