/**
 * Phase 5 — Session feedback (1–5 + comment).
 */

import { Router } from "express";
import { z } from "zod";
import { asyncHandler, HttpError, requireEventAccess } from "../lib/authorization";
import { prisma } from "../lib/db";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";
import { requireFeature } from "../lib/features";

export const feedbackRouter = Router();

feedbackRouter.get(
  "/session/:sessionId",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const session = await prisma.session.findUnique({
      where: { id: req.params.sessionId },
      select: { id: true, eventId: true, endsAt: true },
    });
    if (!session) throw new HttpError(404, { error: "Session not found" });
    const access = await requireEventAccess(req.user!.id, session.eventId);
    await requireFeature(session.eventId, "session_feedback");

    const mine = await prisma.sessionFeedback.findUnique({
      where: { sessionId_userId: { sessionId: session.id, userId: req.user!.id } },
    });

    if (!access.canManageEvent) {
      return res.json({
        sessionEnded: session.endsAt.getTime() <= Date.now(),
        mine,
        summary: null,
      });
    }

    const all = await prisma.sessionFeedback.findMany({
      where: { sessionId: session.id },
      select: { rating: true, comment: true, userId: true, createdAt: true },
    });
    const avg =
      all.length === 0 ? null : all.reduce((s, r) => s + r.rating, 0) / all.length;
    const histogram = [1, 2, 3, 4, 5].map((n) => ({
      rating: n,
      count: all.filter((r) => r.rating === n).length,
    }));

    return res.json({
      sessionEnded: session.endsAt.getTime() <= Date.now(),
      mine,
      summary: { count: all.length, average: avg, histogram, comments: all.filter((r) => r.comment) },
    });
  }),
);

const submitSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(4000).optional().nullable(),
});

feedbackRouter.put(
  "/session/:sessionId",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const session = await prisma.session.findUnique({
      where: { id: req.params.sessionId },
      select: { id: true, eventId: true, endsAt: true },
    });
    if (!session) throw new HttpError(404, { error: "Session not found" });
    await requireEventAccess(req.user!.id, session.eventId);
    await requireFeature(session.eventId, "session_feedback");

    if (session.endsAt.getTime() > Date.now()) {
      throw new HttpError(400, { error: "Feedback opens after the session ends" });
    }

    const row = await prisma.sessionFeedback.upsert({
      where: { sessionId_userId: { sessionId: session.id, userId: req.user!.id } },
      create: {
        sessionId: session.id,
        userId: req.user!.id,
        rating: parsed.data.rating,
        comment: parsed.data.comment?.trim() || null,
      },
      update: {
        rating: parsed.data.rating,
        comment: parsed.data.comment?.trim() || null,
      },
    });
    return res.json(row);
  }),
);

feedbackRouter.get(
  "/event/:eventId/summary",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    await requireEventAccess(req.user!.id, req.params.eventId, { manage: true });
    await requireFeature(req.params.eventId, "session_feedback");

    const sessions = await prisma.session.findMany({
      where: { eventId: req.params.eventId },
      select: {
        id: true,
        title: true,
        feedback: { select: { rating: true } },
      },
      orderBy: { startsAt: "asc" },
    });

    return res.json(
      sessions.map((s) => {
        const count = s.feedback.length;
        const average =
          count === 0 ? null : s.feedback.reduce((a, f) => a + f.rating, 0) / count;
        return { sessionId: s.id, title: s.title, count, average };
      }),
    );
  }),
);
