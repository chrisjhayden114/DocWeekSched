/**
 * Phase A4 — Matchmaker API.
 */

import { Router } from "express";
import { z } from "zod";
import { asyncHandler, HttpError, requireEventAccess } from "../lib/authorization";
import { resolveEventFromRequest } from "../lib/requestEvent";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";
import { requireFeature, featureEnabled } from "../lib/features";
import {
  getMatchMeState,
  listSuggestionsForUser,
  maybeEnqueueJoinMatch,
  runMatchBatch,
  setMatchMeEnabled,
  weeklyBatchKey,
} from "../lib/ai/matchmaker";
import { getDirectConversation } from "../lib/conversations";
import { prisma } from "../lib/db";
import { AI_GENERATED_CHIP_LABEL } from "@event-app/shared";
import { validationErrorBody } from "../lib/errors";

export const matchmakerRouter = Router();

matchmakerRouter.get(
  "/meta",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id);
    const enabled = await featureEnabled(event.id, "matchmaker");
    const state = await getMatchMeState(event.id, req.user!.id);
    return res.json({
      enabled,
      eventId: event.id,
      ...state,
      aiGeneratedLabel: AI_GENERATED_CHIP_LABEL,
    });
  }),
);

matchmakerRouter.get(
  "/suggestions",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id);
    await requireFeature(event.id, "matchmaker");

    const batchKey = typeof req.query.batchKey === "string" ? req.query.batchKey : undefined;
    const rows = await listSuggestionsForUser(event.id, req.user!.id, batchKey);
    return res.json({
      suggestions: rows.map((r) => ({
        id: r.id,
        suggestedUserId: r.suggestedUserId,
        rank: r.rank,
        whyLine: r.whyLine,
        draftIntro: r.draftIntro,
        proposedSlots: r.proposedSlots,
        batchKey: r.batchKey,
        aiGenerated: r.aiGenerated,
        createdAt: r.createdAt.toISOString(),
        user: {
          id: r.suggestedUser.id,
          name: r.suggestedUser.name,
          title: r.suggestedUser.title,
          affiliation: r.suggestedUser.affiliation,
          researchInterests: r.suggestedUser.researchInterests,
          photoUrl: r.suggestedUser.photoUrl,
        },
      })),
      aiGeneratedLabel: AI_GENERATED_CHIP_LABEL,
    });
  }),
);

const matchMeSchema = z.object({
  matchMeEnabled: z.boolean(),
});

matchmakerRouter.put(
  "/me",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = matchMeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationErrorBody(parsed.error));
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id);
    await requireFeature(event.id, "matchmaker");
    const out = await setMatchMeEnabled(event.id, req.user!.id, parsed.data.matchMeEnabled);
    return res.json(out);
  }),
);

const refreshSchema = z.object({
  batchKey: z.enum(["join", "week"]).optional(),
});

matchmakerRouter.post(
  "/refresh",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = refreshSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(validationErrorBody(parsed.error));
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id);
    await requireFeature(event.id, "matchmaker");

    const batchKey =
      parsed.data.batchKey === "week" ? weeklyBatchKey() : parsed.data.batchKey === "join" ? "join" : weeklyBatchKey();

    const result = await runMatchBatch({
      eventId: event.id,
      organizationId: event.organizationId,
      forUserId: req.user!.id,
      batchKey,
      deliverNotification: true,
      includeMeetingSlots: true,
    });

    return res.json({
      ...result,
      aiGeneratedLabel: AI_GENERATED_CHIP_LABEL,
      /** Never auto-sends — drafts are for the composer only. */
      autoSent: false,
    });
  }),
);

matchmakerRouter.post(
  "/join-hook",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id);
    if (!(await featureEnabled(event.id, "matchmaker"))) {
      return res.json({ enqueued: false });
    }
    const out = await maybeEnqueueJoinMatch({
      eventId: event.id,
      organizationId: event.organizationId,
      userId: req.user!.id,
    });
    return res.json(out);
  }),
);

/**
 * Prepare a draft intro for the DM composer — does NOT send a message.
 * Returns conversationId (get-or-create) + prefilled body + optional slots text.
 */
const draftSchema = z.object({
  suggestionId: z.string().min(1),
});

matchmakerRouter.post(
  "/draft-intro",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = draftSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationErrorBody(parsed.error));

    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id);
    await requireFeature(event.id, "matchmaker");

    const suggestion = await prisma.matchSuggestion.findFirst({
      where: {
        id: parsed.data.suggestionId,
        eventId: event.id,
        forUserId: req.user!.id,
      },
      include: {
        suggestedUser: { select: { id: true, name: true } },
      },
    });
    if (!suggestion) throw new HttpError(404, { error: "Suggestion not found" });

    // Ensure DM thread exists but do NOT post a message
    let conversationId =
      (await getDirectConversation(req.user!.id, suggestion.suggestedUserId, event.id))?.id ?? null;
    if (!conversationId) {
      const created = await prisma.conversation.create({
        data: {
          eventId: event.id,
          type: "DIRECT",
          name: null,
          members: {
            create: [{ userId: req.user!.id }, { userId: suggestion.suggestedUserId }],
          },
        },
      });
      conversationId = created.id;
    }

    const threadId = conversationId;

    const slots = (suggestion.proposedSlots as Array<{ startsAt: string; endsAt: string }> | null) || [];
    let body = suggestion.draftIntro.trim();
    if (slots.length) {
      const slotLines = slots
        .slice(0, 2)
        .map((s, i) => {
          const a = new Date(s.startsAt);
          const b = new Date(s.endsAt);
          return `${i + 1}) ${a.toISOString()} – ${b.toISOString()}`;
        })
        .join("\n");
      body = `${body}\n\nIf helpful, I’m free at:\n${slotLines}`;
    }

    // Verify no message was auto-created in this request path
    const messageCount = await prisma.conversationMessage.count({
      where: { conversationId: threadId },
    });

    return res.json({
      conversationId: threadId,
      toUserId: suggestion.suggestedUserId,
      toUserName: suggestion.suggestedUser.name,
      prefillBody: body,
      whyLine: suggestion.whyLine,
      proposedSlots: slots,
      aiGenerated: true as const,
      aiGeneratedLabel: AI_GENERATED_CHIP_LABEL,
      autoSent: false as const,
      existingMessageCount: messageCount,
    });
  }),
);
