import { prisma } from "../db";
import { dailyPushBudgetCeiling } from "./types";
import { localDayKey } from "./timezone";

export type BudgetStatus = {
  dayKey: string;
  used: number;
  remaining: number;
  ceiling: number;
};

export async function getPushBudgetStatus(userId: string, timeZone: string, now = new Date()): Promise<BudgetStatus> {
  const ceiling = dailyPushBudgetCeiling();
  const dayKey = localDayKey(now, timeZone);
  const row = await prisma.notificationPushDay.findUnique({
    where: { userId_dayKey: { userId, dayKey } },
  });
  const used = row?.pushCount ?? 0;
  return {
    dayKey,
    used,
    remaining: Math.max(0, ceiling - used),
    ceiling,
  };
}

/** Minimum remaining across recipients (composer meter / worst-case). */
export async function minRemainingPushBudget(
  userIds: string[],
  timeZoneByUser: Map<string, string>,
  fallbackTimeZone: string,
  now = new Date(),
): Promise<{ remaining: number; ceiling: number }> {
  const ceiling = dailyPushBudgetCeiling();
  if (userIds.length === 0) return { remaining: ceiling, ceiling };
  let minRem = ceiling;
  for (const userId of userIds) {
    const tz = timeZoneByUser.get(userId) || fallbackTimeZone;
    const status = await getPushBudgetStatus(userId, tz, now);
    minRem = Math.min(minRem, status.remaining);
  }
  return { remaining: minRem, ceiling };
}

/**
 * Atomically charge one push against the daily ledger if under ceiling.
 * Returns whether the charge succeeded.
 */
export async function tryChargePushBudget(
  userId: string,
  timeZone: string,
  now = new Date(),
): Promise<{ charged: boolean; status: BudgetStatus }> {
  const ceiling = dailyPushBudgetCeiling();
  const dayKey = localDayKey(now, timeZone);

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.notificationPushDay.findUnique({
      where: { userId_dayKey: { userId, dayKey } },
    });
    const used = existing?.pushCount ?? 0;
    if (used >= ceiling) {
      return { charged: false, used };
    }
    if (existing) {
      const updated = await tx.notificationPushDay.update({
        where: { id: existing.id },
        data: { pushCount: used + 1 },
      });
      return { charged: true, used: updated.pushCount };
    }
    await tx.notificationPushDay.create({
      data: { userId, dayKey, pushCount: 1 },
    });
    return { charged: true, used: 1 };
  });

  return {
    charged: result.charged,
    status: {
      dayKey,
      used: result.used,
      remaining: Math.max(0, ceiling - result.used),
      ceiling,
    },
  };
}
