import { prisma } from "./db";

export const POINTS = {
  SESSION_LIKE: 2,
  MESSAGE: 2,
  SESSION_CHAT_MESSAGE: 2,
  NETWORK_THREAD: 5,
  NETWORK_REPLY: 3,
  SESSION_JOIN: 1,
  SESSION_RESOURCE: 1,
} as const;

export async function awardEngagementPoints(userId: string, delta: number) {
  if (delta <= 0) return;
  await prisma.user.update({
    where: { id: userId },
    data: { engagementPoints: { increment: delta } },
  });
}
