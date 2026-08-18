import { prisma } from "../db";
import { withDbRetry } from "../dbRetry";
import { writeAuditLog } from "../ai/audit";
import { log } from "../log";
import { MEMBERSHIP_PURGE_BATCH, membershipPurgeCutoff } from "./purgeWindow";

export { MEMBERSHIP_PURGE_AFTER_MS, MEMBERSHIP_PURGE_BATCH, membershipPurgeCutoff } from "./purgeWindow";

/**
 * Periodic sweep: hard-delete EventMembership rows whose deletedAt is older
 * than ~30 days. Matches the roster-removal copy and the schema comment.
 */
export async function sweepSoftDeletedMemberships(
  now = new Date(),
): Promise<{ purged: number }> {
  const cutoff = membershipPurgeCutoff(now);
  const stale = await withDbRetry(() =>
    prisma.eventMembership.findMany({
      where: { deletedAt: { not: null, lte: cutoff } },
      select: { id: true },
      take: MEMBERSHIP_PURGE_BATCH,
    }),
  );
  if (stale.length === 0) return { purged: 0 };

  const { count } = await withDbRetry(() =>
    prisma.eventMembership.deleteMany({
      where: { id: { in: stale.map((row) => row.id) } },
    }),
  );

  await writeAuditLog({
    actorUserId: null,
    action: "OTHER",
    entityType: "event_membership",
    payload: {
      sweep: "event_membership_purge",
      purged: count,
      cutoff: cutoff.toISOString(),
    },
  });

  log("info", "sweepSoftDeletedMemberships: purged stale roster rows", {
    purged: count,
    cutoff: cutoff.toISOString(),
  });

  return { purged: count };
}
