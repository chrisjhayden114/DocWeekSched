/**
 * Phase 5 — Live session polls.
 */

import { Router } from "express";
import { z } from "zod";
import { SessionPollStatus } from "@prisma/client";
import { asyncHandler, HttpError, requireEventAccess } from "../lib/authorization";
import { prisma } from "../lib/db";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";
import { requireFeature } from "../lib/features";

export const pollsRouter = Router();

async function sessionForPoll(sessionId: string) {
  return prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, eventId: true },
  });
}

pollsRouter.get(
  "/session/:sessionId",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const session = await sessionForPoll(req.params.sessionId);
    if (!session) throw new HttpError(404, { error: "Session not found" });
    const access = await requireEventAccess(req.user!.id, session.eventId);
    await requireFeature(session.eventId, "session_polls");

    const polls = await prisma.sessionPoll.findMany({
      where: {
        sessionId: session.id,
        ...(access.canManageEvent ? {} : { status: { in: [SessionPollStatus.OPEN, SessionPollStatus.CLOSED] } }),
      },
      orderBy: { createdAt: "desc" },
      include: {
        options: { orderBy: { sortOrder: "asc" }, include: { _count: { select: { votes: true } } } },
        votes: { where: { userId: req.user!.id }, select: { optionId: true } },
      },
    });

    return res.json(
      polls.map((p) => {
        const showResults = access.canManageEvent || p.showResultsToAttendees || p.status === SessionPollStatus.CLOSED;
        return {
          id: p.id,
          question: p.question,
          status: p.status,
          showResultsToAttendees: p.showResultsToAttendees,
          openedAt: p.openedAt,
          closedAt: p.closedAt,
          myOptionId: p.votes[0]?.optionId ?? null,
          options: p.options.map((o) => ({
            id: o.id,
            label: o.label,
            sortOrder: o.sortOrder,
            voteCount: showResults ? o._count.votes : undefined,
          })),
        };
      }),
    );
  }),
);

const createSchema = z.object({
  question: z.string().min(1).max(500),
  options: z.array(z.string().min(1).max(200)).min(2).max(12),
  showResultsToAttendees: z.boolean().optional(),
});

pollsRouter.post(
  "/session/:sessionId",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const session = await sessionForPoll(req.params.sessionId);
    if (!session) throw new HttpError(404, { error: "Session not found" });
    await requireEventAccess(req.user!.id, session.eventId, { manage: true });
    await requireFeature(session.eventId, "session_polls");

    const poll = await prisma.sessionPoll.create({
      data: {
        sessionId: session.id,
        question: parsed.data.question.trim(),
        showResultsToAttendees: parsed.data.showResultsToAttendees ?? true,
        createdById: req.user!.id,
        status: SessionPollStatus.DRAFT,
        options: {
          create: parsed.data.options.map((label, i) => ({
            label: label.trim(),
            sortOrder: i,
          })),
        },
      },
      include: { options: { orderBy: { sortOrder: "asc" } } },
    });
    return res.status(201).json(poll);
  }),
);

pollsRouter.post(
  "/:pollId/open",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const poll = await prisma.sessionPoll.findUnique({
      where: { id: req.params.pollId },
      include: { session: { select: { eventId: true } } },
    });
    if (!poll) throw new HttpError(404, { error: "Poll not found" });
    await requireEventAccess(req.user!.id, poll.session.eventId, { manage: true });
    await requireFeature(poll.session.eventId, "session_polls");

    const updated = await prisma.sessionPoll.update({
      where: { id: poll.id },
      data: { status: SessionPollStatus.OPEN, openedAt: new Date(), closedAt: null },
    });
    return res.json(updated);
  }),
);

pollsRouter.post(
  "/:pollId/close",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const poll = await prisma.sessionPoll.findUnique({
      where: { id: req.params.pollId },
      include: { session: { select: { eventId: true } } },
    });
    if (!poll) throw new HttpError(404, { error: "Poll not found" });
    await requireEventAccess(req.user!.id, poll.session.eventId, { manage: true });
    await requireFeature(poll.session.eventId, "session_polls");

    const updated = await prisma.sessionPoll.update({
      where: { id: poll.id },
      data: { status: SessionPollStatus.CLOSED, closedAt: new Date() },
    });
    return res.json(updated);
  }),
);

const voteSchema = z.object({
  optionId: z.string().min(1),
});

pollsRouter.post(
  "/:pollId/vote",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = voteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const poll = await prisma.sessionPoll.findUnique({
      where: { id: req.params.pollId },
      include: {
        session: { select: { eventId: true } },
        options: { select: { id: true } },
      },
    });
    if (!poll) throw new HttpError(404, { error: "Poll not found" });
    await requireEventAccess(req.user!.id, poll.session.eventId);
    await requireFeature(poll.session.eventId, "session_polls");
    if (poll.status !== SessionPollStatus.OPEN) {
      throw new HttpError(400, { error: "Poll is not open" });
    }
    if (!poll.options.some((o) => o.id === parsed.data.optionId)) {
      throw new HttpError(400, { error: "Invalid option" });
    }

    await prisma.sessionPollVote.upsert({
      where: { pollId_userId: { pollId: poll.id, userId: req.user!.id } },
      create: { pollId: poll.id, optionId: parsed.data.optionId, userId: req.user!.id },
      update: { optionId: parsed.data.optionId },
    });
    return res.json({ ok: true, optionId: parsed.data.optionId });
  }),
);
