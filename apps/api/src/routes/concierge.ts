/**
 * Phase A3 — Attendee Concierge API + organizer FAQ.
 */

import { Router } from "express";
import { z } from "zod";
import { CONCIERGE_STARTER_CHIPS } from "@event-app/shared";
import { asyncHandler, HttpError, requireEventAccess } from "../lib/authorization";
import { prisma } from "../lib/db";
import { resolveEventFromRequest } from "../lib/requestEvent";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";
import { requireFeature, featureEnabled } from "../lib/features";
import {
  confirmPendingAction,
  getOrCreateConversation,
  listConversationMessages,
  runConciergeTurn,
} from "../lib/ai/concierge";

export const conciergeRouter = Router();

conciergeRouter.get(
  "/meta",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id);
    const enabled = await featureEnabled(event.id, "concierge");
    return res.json({
      enabled,
      starterChips: CONCIERGE_STARTER_CHIPS,
      eventId: event.id,
    });
  }),
);

conciergeRouter.get(
  "/history",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id);
    await requireFeature(event.id, "concierge");
    const conversation = await getOrCreateConversation(event.id, req.user!.id);
    const messages = await listConversationMessages(conversation.id);
    return res.json({
      conversationId: conversation.id,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role.toLowerCase(),
        body: m.body,
        aiGenerated: m.aiGenerated,
        pendingActionIds: m.pendingActionIds,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  }),
);

const turnSchema = z.object({
  message: z.string().min(1).max(4000),
});

conciergeRouter.post(
  "/turn",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = turnSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id);
    await requireFeature(event.id, "concierge");

    const result = await runConciergeTurn({
      eventId: event.id,
      organizationId: event.organizationId,
      userId: req.user!.id,
      userMessage: parsed.data.message,
    });

    if (result.teaser) {
      return res.status(402).json({
        error: result.teaser.message,
        code: "CAP_EXCEEDED",
        teaser: result.teaser,
        conversationId: result.conversationId,
        assistantMessage: result.assistantMessage,
        aiGenerated: true as const,
        actionCards: [],
      });
    }

    return res.json(result);
  }),
);

const confirmSchema = z.object({
  pendingActionId: z.string().min(1),
});

conciergeRouter.post(
  "/confirm",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = confirmSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id);
    await requireFeature(event.id, "concierge");

    // userId + eventId from server session only — body may only carry the pendingActionId
    const out = await confirmPendingAction({
      pendingActionId: parsed.data.pendingActionId,
      userId: req.user!.id,
      eventId: event.id,
    });

    return res.json({
      ok: true,
      pendingActionId: out.pendingActionId,
      tool: out.tool,
      result: out.result,
    });
  }),
);

/** Organizer FAQ CRUD */
export const eventFaqRouter = Router();

eventFaqRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id);
    const rows = await prisma.eventFaq.findMany({
      where: { eventId: event.id },
      orderBy: { sortOrder: "asc" },
    });
    return res.json(rows);
  }),
);

const faqBodySchema = z.object({
  question: z.string().min(1).max(500),
  answer: z.string().min(1).max(5000),
  sortOrder: z.number().int().optional(),
});

eventFaqRouter.post(
  "/",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = faqBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    const max = await prisma.eventFaq.aggregate({
      where: { eventId: event.id },
      _max: { sortOrder: true },
    });
    const row = await prisma.eventFaq.create({
      data: {
        eventId: event.id,
        question: parsed.data.question.trim(),
        answer: parsed.data.answer.trim(),
        sortOrder: parsed.data.sortOrder ?? (max._max.sortOrder ?? 0) + 1,
      },
    });
    return res.status(201).json(row);
  }),
);

eventFaqRouter.put(
  "/:id",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = faqBodySchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    const existing = await prisma.eventFaq.findFirst({
      where: { id: req.params.id, eventId: event.id },
    });
    if (!existing) throw new HttpError(404, { error: "FAQ not found" });
    const row = await prisma.eventFaq.update({
      where: { id: existing.id },
      data: {
        question: parsed.data.question?.trim(),
        answer: parsed.data.answer?.trim(),
        sortOrder: parsed.data.sortOrder,
      },
    });
    return res.json(row);
  }),
);

eventFaqRouter.delete(
  "/:id",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    const existing = await prisma.eventFaq.findFirst({
      where: { id: req.params.id, eventId: event.id },
    });
    if (!existing) throw new HttpError(404, { error: "FAQ not found" });
    await prisma.eventFaq.delete({ where: { id: existing.id } });
    return res.json({ ok: true });
  }),
);
