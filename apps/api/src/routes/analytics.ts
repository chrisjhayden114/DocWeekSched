/**
 * Phase 5 — Organizer analytics (ingests existing engagement points).
 */

import { Router } from "express";
import { asyncHandler, HttpError, requireEventAccess } from "../lib/authorization";
import { prisma } from "../lib/db";
import { AuthedRequest, requireAuth } from "../lib/middleware";
import { can } from "../lib/billing/entitlements";

export const analyticsRouter = Router();

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.join(","), ...rows.map((r) => r.map(csvEscape).join(","))].join("\n");
}

analyticsRouter.get(
  "/event/:eventId",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await prisma.event.findUnique({
      where: { id: req.params.eventId },
      select: {
        id: true,
        name: true,
        organizationId: true,
        startDate: true,
        endDate: true,
        seriesId: true,
      },
    });
    if (!event) throw new HttpError(404, { error: "Event not found" });
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    if (!(await can(event.organizationId, "analytics"))) {
      throw new HttpError(402, { error: "Analytics requires a Per-event or Pro plan", code: "PLAN_LIMIT" });
    }

    const memberships = await prisma.eventMembership.findMany({
      where: { eventId: event.id, deletedAt: null },
      select: {
        userId: true,
        createdAt: true,
        directoryOptIn: true,
        user: { select: { engagementPoints: true, emailVerifiedAt: true } },
      },
    });
    const totalRegistrants = memberships.length;
    const directoryOptIns = memberships.filter((m) => m.directoryOptIn).length;
    const checkIns = await prisma.checkIn.count({ where: { eventId: event.id } });

    // Adoption: registrants who used the app (points, messages, joins, or check-in)
    const [messagers, attenders, checkInRows] = await Promise.all([
      prisma.conversationMessage.findMany({
        where: { conversation: { eventId: event.id } },
        select: { userId: true },
        distinct: ["userId"],
      }),
      prisma.sessionAttendance.findMany({
        where: { status: "JOINING", session: { eventId: event.id } },
        select: { userId: true },
        distinct: ["userId"],
      }),
      prisma.checkIn.findMany({
        where: { eventId: event.id },
        select: { userId: true },
      }),
    ]);
    const activeIds = new Set([
      ...memberships.filter((m) => m.user.engagementPoints > 0 || m.user.emailVerifiedAt).map((m) => m.userId),
      ...messagers.map((m) => m.userId),
      ...attenders.map((a) => a.userId),
      ...checkInRows.map((c) => c.userId),
    ]);
    const adoptionRate = totalRegistrants === 0 ? 0 : activeIds.size / totalRegistrants;

    // Registrations over time (by day)
    const byDay = new Map<string, number>();
    for (const m of memberships) {
      const key = m.createdAt.toISOString().slice(0, 10);
      byDay.set(key, (byDay.get(key) || 0) + 1);
    }
    const registrationsOverTime = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, count]) => ({ day, count }));

    const sessions = await prisma.session.findMany({
      where: { eventId: event.id },
      select: {
        id: true,
        title: true,
        startsAt: true,
        _count: {
          select: {
            attendances: true,
            likes: true,
            discussionThreads: true,
            polls: true,
            feedback: true,
          },
        },
        feedback: { select: { rating: true } },
        attendances: { where: { status: "JOINING" }, select: { id: true } },
      },
      orderBy: { startsAt: "asc" },
    });

    const sessionPopularity = sessions.map((s) => {
      const joins = s.attendances.length;
      const avgFeedback =
        s.feedback.length === 0
          ? null
          : s.feedback.reduce((a, f) => a + f.rating, 0) / s.feedback.length;
      return {
        sessionId: s.id,
        title: s.title,
        joins,
        likes: s._count.likes,
        qaThreads: s._count.discussionThreads,
        polls: s._count.polls,
        feedbackCount: s._count.feedback,
        avgFeedback,
      };
    });

    const [messageCount, meetingCount, pollVotes, qaUpvotes] = await Promise.all([
      prisma.conversationMessage.count({ where: { conversation: { eventId: event.id } } }),
      prisma.meetingRequest.count({ where: { eventId: event.id } }),
      prisma.sessionPollVote.count({ where: { poll: { session: { eventId: event.id } } } }),
      prisma.sessionDiscussionUpvote.count({
        where: { thread: { session: { eventId: event.id } } },
      }),
    ]);

    const totalPoints = memberships.reduce((s, m) => s + m.user.engagementPoints, 0);

    const format = String(req.query.format || "");
    if (format === "csv") {
      const csv = toCsv(
        ["sessionId", "title", "joins", "likes", "qaThreads", "polls", "feedbackCount", "avgFeedback"],
        sessionPopularity.map((s) => [
          s.sessionId,
          s.title,
          s.joins,
          s.likes,
          s.qaThreads,
          s.polls,
          s.feedbackCount,
          s.avgFeedback,
        ]),
      );
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="analytics-${event.id}.csv"`);
      return res.send(csv);
    }

    return res.json({
      eventId: event.id,
      eventName: event.name,
      headline: {
        adoptionRate,
        adoptionCount: activeIds.size,
        registrants: totalRegistrants,
        checkInRate: totalRegistrants === 0 ? 0 : checkIns / totalRegistrants,
        checkIns,
        directoryOptInRate: totalRegistrants === 0 ? 0 : directoryOptIns / totalRegistrants,
        directoryOptIns,
        totalEngagementPoints: totalPoints,
      },
      registrationsOverTime,
      sessionPopularity,
      volume: {
        messages: messageCount,
        meetings: meetingCount,
        pollVotes,
        qaUpvotes,
      },
    });
  }),
);

analyticsRouter.get(
  "/series/:seriesId",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const series = await prisma.eventSeries.findUnique({
      where: { id: req.params.seriesId },
      select: { id: true, organizationId: true, name: true },
    });
    if (!series) throw new HttpError(404, { error: "Series not found" });
    if (!(await can(series.organizationId, "analytics"))) {
      throw new HttpError(402, { error: "Analytics requires a Per-event or Pro plan", code: "PLAN_LIMIT" });
    }

    const events = await prisma.event.findMany({
      where: { seriesId: series.id },
      select: { id: true, name: true, startDate: true },
      orderBy: { startDate: "asc" },
    });
    if (events.length) {
      await requireEventAccess(req.user!.id, events[0]!.id, { manage: true });
    }

    const editions = [];
    for (const e of events) {
      const [registrants, checkIns, pointsAgg] = await Promise.all([
        prisma.eventMembership.count({ where: { eventId: e.id, deletedAt: null } }),
        prisma.checkIn.count({ where: { eventId: e.id } }),
        prisma.eventMembership.findMany({
          where: { eventId: e.id, deletedAt: null },
          select: { user: { select: { engagementPoints: true } } },
        }),
      ]);
      editions.push({
        eventId: e.id,
        name: e.name,
        startDate: e.startDate,
        registrants,
        checkIns,
        checkInRate: registrants === 0 ? 0 : checkIns / registrants,
        totalEngagementPoints: pointsAgg.reduce((s, m) => s + m.user.engagementPoints, 0),
      });
    }

    return res.json({ seriesId: series.id, seriesName: series.name, editions });
  }),
);
