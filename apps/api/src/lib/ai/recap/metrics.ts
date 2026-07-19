/**
 * Deterministic recap metrics — pure Prisma/SQL, no LLM.
 * Tests assert against this same function (no second implementation).
 */

import {
  SessionAttendanceStatus,
  type SessionJoinMode,
} from "@prisma/client";
import { prisma } from "../../db";
import type {
  ModeCounts,
  RecapJoinModeKey,
  RecapMetricsSnapshot,
  RecapSessionMetrics,
} from "./types";

function modeKey(joinMode: SessionJoinMode | null): RecapJoinModeKey {
  return joinMode ?? "UNKNOWN";
}

function bump(counts: ModeCounts, key: RecapJoinModeKey): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function rate(num: number, den: number): number {
  return den === 0 ? 0 : num / den;
}

/**
 * Fixed sort keys for top sessions (stable, deterministic):
 * 1. joinedTotal desc
 * 2. feedbackCount desc
 * 3. avgFeedback desc (nulls last)
 * 4. likes desc
 * 5. qaThreads desc
 * 6. sessionId asc (tie-break)
 */
export function compareTopSessions(
  a: Pick<RecapSessionMetrics, "sessionId" | "joinedTotal" | "feedbackCount" | "avgFeedback" | "likes" | "qaThreads">,
  b: Pick<RecapSessionMetrics, "sessionId" | "joinedTotal" | "feedbackCount" | "avgFeedback" | "likes" | "qaThreads">,
): number {
  if (b.joinedTotal !== a.joinedTotal) return b.joinedTotal - a.joinedTotal;
  if (b.feedbackCount !== a.feedbackCount) return b.feedbackCount - a.feedbackCount;
  const aAvg = a.avgFeedback ?? -1;
  const bAvg = b.avgFeedback ?? -1;
  if (bAvg !== aAvg) return bAvg - aAvg;
  if (b.likes !== a.likes) return b.likes - a.likes;
  if (b.qaThreads !== a.qaThreads) return b.qaThreads - a.qaThreads;
  return a.sessionId.localeCompare(b.sessionId);
}

export async function computeRecapMetrics(eventId: string): Promise<RecapMetricsSnapshot> {
  const memberships = await prisma.eventMembership.findMany({
    where: { eventId, deletedAt: null },
    select: {
      userId: true,
      user: { select: { engagementPoints: true, emailVerifiedAt: true } },
    },
  });
  const registrants = memberships.length;

  const checkInRows = await prisma.checkIn.findMany({
    where: { eventId },
    select: { userId: true },
  });
  const checkedInUserIds = new Set(checkInRows.map((c) => c.userId));
  const checkIns = checkedInUserIds.size;

  const [messagers, attenders] = await Promise.all([
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
  ]);

  const activeIds = new Set([
    ...memberships
      .filter((m) => m.user.engagementPoints > 0 || m.user.emailVerifiedAt)
      .map((m) => m.userId),
    ...messagers.map((m) => m.userId),
    ...attenders.map((a) => a.userId),
    ...checkedInUserIds,
  ]);

  const sessions = await prisma.session.findMany({
    where: { eventId },
    select: {
      id: true,
      title: true,
      startsAt: true,
      _count: {
        select: {
          likes: true,
          discussionThreads: true,
        },
      },
      feedback: { select: { rating: true } },
      attendances: {
        where: { status: SessionAttendanceStatus.JOINING },
        select: { userId: true, joinMode: true },
      },
      polls: {
        select: {
          _count: { select: { votes: true } },
        },
      },
    },
    orderBy: { startsAt: "asc" },
  });

  const sessionMetrics: RecapSessionMetrics[] = sessions.map((s) => {
    const joinedByMode: ModeCounts = {};
    const checkedInAttributedByMode: ModeCounts = {};
    const noShowByMode: ModeCounts = {};
    let joinedTotal = 0;
    let checkedInAttributedTotal = 0;
    let noShowTotal = 0;

    for (const row of s.attendances) {
      const key = modeKey(row.joinMode);
      bump(joinedByMode, key);
      joinedTotal += 1;
      if (checkedInUserIds.has(row.userId)) {
        bump(checkedInAttributedByMode, key);
        checkedInAttributedTotal += 1;
      } else {
        bump(noShowByMode, key);
        noShowTotal += 1;
      }
    }

    const feedbackCount = s.feedback.length;
    const avgFeedback =
      feedbackCount === 0
        ? null
        : s.feedback.reduce((sum, f) => sum + f.rating, 0) / feedbackCount;
    const pollVotes = s.polls.reduce((sum, p) => sum + p._count.votes, 0);

    return {
      sessionId: s.id,
      title: s.title,
      startsAt: s.startsAt.toISOString(),
      joinedByMode,
      joinedTotal,
      checkedInAttributedByMode,
      checkedInAttributedTotal,
      noShowTotal,
      noShowByMode,
      likes: s._count.likes,
      qaThreads: s._count.discussionThreads,
      pollVotes,
      feedbackCount,
      avgFeedback,
    };
  });

  const [qaUpvotes, communityThreads, communityReplies] = await Promise.all([
    prisma.sessionDiscussionUpvote.count({
      where: { thread: { session: { eventId } } },
    }),
    prisma.networkThread.count({ where: { eventId } }),
    prisma.networkReply.count({ where: { thread: { eventId } } }),
  ]);

  const engagementPoints = memberships.reduce((sum, m) => sum + m.user.engagementPoints, 0);
  const qaThreads = sessionMetrics.reduce((sum, s) => sum + s.qaThreads, 0);
  const pollVotes = sessionMetrics.reduce((sum, s) => sum + s.pollVotes, 0);

  const ranked = [...sessionMetrics].sort(compareTopSessions);
  const topSessions = ranked.slice(0, 10).map((s) => ({
    sessionId: s.sessionId,
    title: s.title,
    joinedTotal: s.joinedTotal,
    feedbackCount: s.feedbackCount,
    avgFeedback: s.avgFeedback,
    likes: s.likes,
    qaThreads: s.qaThreads,
  }));

  return {
    eventId,
    computedAt: new Date().toISOString(),
    headline: {
      registrants,
      checkIns,
      checkInRate: rate(checkIns, registrants),
      adoptionCount: activeIds.size,
      adoptionRate: rate(activeIds.size, registrants),
    },
    engagement: {
      qaThreads,
      qaUpvotes,
      pollVotes,
      communityThreads,
      communityReplies,
      engagementPoints,
    },
    sessions: sessionMetrics,
    topSessions,
    labels: {
      checkedInAttributedByMode:
        "Event check-in attributed via session join mode (not a per-session door scan)",
    },
  };
}
