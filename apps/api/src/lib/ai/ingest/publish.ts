import { SessionPublishStatus, type Prisma, type PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Promote every DRAFT session on an event to PUBLISHED and return how many
 * were promoted.
 *
 * E13.1: before this, no route ever wrote PUBLISHED — ingest-confirmed drafts
 * could never become attendee-visible. Publishing the event calls this in the
 * same transaction as the status change; the Program tab's "Publish N draft
 * sessions" action calls it for events that are already ACTIVE.
 */
export async function publishEventDraftSessions(db: Db, eventId: string): Promise<number> {
  const result = await db.session.updateMany({
    where: { eventId, publishStatus: SessionPublishStatus.DRAFT },
    data: { publishStatus: SessionPublishStatus.PUBLISHED },
  });
  return result.count;
}
