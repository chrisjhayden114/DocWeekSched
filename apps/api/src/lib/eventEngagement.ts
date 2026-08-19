/**
 * FOSSIL-1 — per-event engagement read model.
 *
 * `User.engagementPoints` is a GLOBAL lifetime counter (points.ts increments it
 * account-wide), so summing it across an event's memberships reports activity
 * from every OTHER event the attendee has ever joined. Until points move to a
 * per-event ledger, per-event reports count the event-scoped signals that
 * already exist, and any lifetime figure is labeled as lifetime.
 */

import { SessionAttendanceStatus } from "@prisma/client";
import { prisma } from "./db";

/** Shown next to any figure derived from the account-wide points counter. */
export const LIFETIME_POINTS_LABEL =
  "Lifetime points across all events on this account — not scoped to this event";

/**
 * Participation actions taken AT one event. Every key is optional so callers
 * contribute only the signals they already query; absent keys count as zero
 * rather than being silently invented.
 */
export type EventEngagementActionCounts = {
  sessionJoins?: number;
  sessionLikes?: number;
  qaThreads?: number;
  qaUpvotes?: number;
  pollVotes?: number;
  feedbackResponses?: number;
  communityThreads?: number;
  communityReplies?: number;
  messages?: number;
  meetings?: number;
  checkIns?: number;
};

export function sumEventEngagementActions(counts: EventEngagementActionCounts): number {
  return Object.values(counts).reduce<number>((sum, n) => sum + (n ?? 0), 0);
}

/**
 * Registrants who did something AT this event. Global signals (lifetime points,
 * account email verification) are deliberately excluded — they say nothing
 * about whether this event was used.
 */
export async function eventEngagementActorIds(eventId: string): Promise<Set<string>> {
  const [
    messagers,
    attenders,
    checkIns,
    likers,
    feedbackAuthors,
    pollVoters,
    qaAuthors,
    qaUpvoters,
    communityAuthors,
    communityRepliers,
  ] = await Promise.all([
    prisma.conversationMessage.findMany({
      where: { conversation: { eventId } },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.sessionAttendance.findMany({
      where: { status: SessionAttendanceStatus.JOINING, session: { eventId } },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.checkIn.findMany({ where: { eventId }, select: { userId: true } }),
    prisma.sessionLike.findMany({
      where: { session: { eventId } },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.sessionFeedback.findMany({
      where: { session: { eventId } },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.sessionPollVote.findMany({
      where: { poll: { session: { eventId } } },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.sessionDiscussionThread.findMany({
      where: { session: { eventId }, authorId: { not: null } },
      select: { authorId: true },
      distinct: ["authorId"],
    }),
    prisma.sessionDiscussionUpvote.findMany({
      where: { thread: { session: { eventId } } },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.networkThread.findMany({
      where: { eventId, authorId: { not: null } },
      select: { authorId: true },
      distinct: ["authorId"],
    }),
    prisma.networkReply.findMany({
      where: { thread: { eventId }, authorId: { not: null } },
      select: { authorId: true },
      distinct: ["authorId"],
    }),
  ]);

  const ids = new Set<string>();
  const actorRows: Array<Array<{ userId?: string | null; authorId?: string | null }>> = [
    messagers,
    attenders,
    checkIns,
    likers,
    feedbackAuthors,
    pollVoters,
    qaUpvoters,
    qaAuthors,
    communityAuthors,
    communityRepliers,
  ];
  for (const rows of actorRows) {
    for (const row of rows) {
      const id = row.userId ?? row.authorId;
      if (id) ids.add(id);
    }
  }
  return ids;
}
