import { ConciergeMessageRole, Prisma } from "@prisma/client";
import type { ConciergeActionCard, ConciergeLink } from "@event-app/shared";
import { prisma } from "../../db";
import { gatewayChat } from "../gateway";
import { buildEventGroundingContext } from "../grounding";
import type { AiChatMessage } from "../types";
import { detectAction, runConciergeDialogue, type DialogueProposal } from "./dialogue";
import { buildConciergeSystemPrompt } from "./prompt";
import { proposeMutation } from "./propose";

export async function getOrCreateConversation(eventId: string, userId: string) {
  return prisma.conciergeConversation.upsert({
    where: { eventId_userId: { eventId, userId } },
    create: { eventId, userId },
    update: {},
  });
}

export async function listConversationMessages(conversationId: string, take = 50) {
  return prisma.conciergeMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    take,
  });
}

/** History window sent to the model on informational turns. */
const HISTORY_TURNS = 6;

export type ConciergeTurnResponse = {
  conversationId: string;
  assistantMessage: string;
  aiGenerated: true;
  actionCards: ConciergeActionCard[];
  mapHint: { roomId: string; mapId?: string | null; label: string } | null;
  handoff: { agent: "A4"; message: string } | null;
  /** In-app navigation offers (open a session, etc.) — E19.3. */
  links: ConciergeLink[];
  refused: boolean;
  usageId?: string;
  teaser?: { kind: "FREE_CAP"; message: string; upgrade?: unknown } | null;
};

/**
 * One attendee turn (AGENT-1 routing):
 * - ACTION intents (add/remove/waitlist/export/meeting/matchmaker) stay 100%
 *   deterministic — regex detection, pending confirm cards, no model text.
 * - Everything else goes to the model with the full grounded EVENT CONTEXT,
 *   and the model's reply IS the assistant message.
 * Both paths meter through A0 (caps enforced exactly as before); gateway
 * errors and empty replies fall back to the old deterministic canned answers.
 * Writes NEVER come from model output.
 */
export async function runConciergeTurn(params: {
  eventId: string;
  organizationId: string;
  userId: string;
  userMessage: string;
}): Promise<ConciergeTurnResponse> {
  const { eventId, organizationId, userId, userMessage } = params;
  const conversation = await getOrCreateConversation(eventId, userId);
  const grounding = await buildEventGroundingContext(eventId, { userId });
  const now = new Date();

  // History window BEFORE persisting this turn's user message.
  const historyRows = await prisma.conciergeMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "desc" },
    take: HISTORY_TURNS,
  });
  const history: AiChatMessage[] = historyRows.reverse().map((m) => ({
    role: m.role === ConciergeMessageRole.USER ? ("user" as const) : ("assistant" as const),
    content: m.body,
  }));

  await prisma.conciergeMessage.create({
    data: {
      conversationId: conversation.id,
      role: ConciergeMessageRole.USER,
      body: userMessage.slice(0, 4000),
      aiGenerated: false,
    },
  });

  const action = await detectAction({ userText: userMessage, grounding, userId, now });

  // Meter through A0 on every turn (CONCIERGE caps unchanged). Action turns
  // send a minimal metering prompt and never use the model's text; grounded
  // informational turns send system context + history + the user message.
  const gw = action
    ? await gatewayChat(
        [
          {
            role: "user",
            content: `Concierge turn for event ${grounding.eventId}: ${userMessage.slice(0, 500)}`,
          },
        ],
        { organizationId, eventId, userId, feature: "CONCIERGE" },
      )
    : await gatewayChat(
        [
          {
            role: "system",
            content: buildConciergeSystemPrompt(grounding, grounding.myAgendaSessionIds, now),
          },
          ...history,
          { role: "user", content: userMessage.slice(0, 4000) },
        ],
        { organizationId, eventId, userId, feature: "CONCIERGE" },
      );

  if (!gw.ok && gw.code === "CAP_EXCEEDED") {
    const teaserMessage =
      "You’ve used this event’s Concierge allowance. Upgrade for more help during the program — your conversation history stays.";
    await prisma.conciergeMessage.create({
      data: {
        conversationId: conversation.id,
        role: ConciergeMessageRole.ASSISTANT,
        body: teaserMessage,
        aiGenerated: true,
        pendingActionIds: [] as unknown as Prisma.InputJsonValue,
      },
    });
    return {
      conversationId: conversation.id,
      assistantMessage: teaserMessage,
      aiGenerated: true,
      actionCards: [],
      mapHint: null,
      handoff: null,
      links: [],
      refused: false,
      teaser: { kind: "FREE_CAP", message: teaserMessage, upgrade: gw.upgrade },
    };
  }

  let assistantMessage: string;
  let mutationProposals: DialogueProposal[] = [];
  let mapHint: ConciergeTurnResponse["mapHint"] = null;
  let handoff: ConciergeTurnResponse["handoff"] = null;
  let links: ConciergeLink[] = [];
  let refused = false;

  if (action) {
    assistantMessage = action.assistantMessage;
    mutationProposals = action.mutationProposals;
    handoff = action.handoff;
    links = action.links;
  } else {
    // The mock provider answers "{}" when no reply was injected — that is
    // "no answer", not an answer; treat it like an empty reply.
    const modelText = gw.ok ? gw.text.trim() : "";
    if (modelText && modelText !== "{}") {
      assistantMessage = modelText;
    } else {
      // Honest fallback, never blank: the old deterministic canned answer /
      // decline for this input. Read-only — action intents were already
      // handled above, so fallback proposals are intentionally dropped.
      const dialogue = await runConciergeDialogue({ userText: userMessage, grounding, userId, now });
      assistantMessage = dialogue.assistantMessage;
      mapHint = dialogue.mapHint;
      handoff = dialogue.handoff;
      links = dialogue.links;
      refused = dialogue.refused;
    }
  }

  const actionCards: ConciergeActionCard[] = [];
  for (const proposal of mutationProposals) {
    const card = await proposeMutation({
      eventId,
      userId,
      conversationId: conversation.id,
      tool: proposal.tool,
      args: proposal.args,
      grounding,
    });
    actionCards.push(card);
  }

  const pendingIds = actionCards.map((c) => c.pendingActionId);

  await prisma.conciergeMessage.create({
    data: {
      conversationId: conversation.id,
      role: ConciergeMessageRole.ASSISTANT,
      body: assistantMessage,
      aiGenerated: true,
      toolProposals: mutationProposals.length
        ? (mutationProposals as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      pendingActionIds: pendingIds.length
        ? (pendingIds as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      usageId: gw.ok ? gw.usageId : null,
    },
  });

  await prisma.conciergeConversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date() },
  });

  return {
    conversationId: conversation.id,
    assistantMessage,
    aiGenerated: true,
    actionCards,
    mapHint,
    handoff,
    links,
    refused,
    usageId: gw.ok ? gw.usageId : undefined,
    teaser: null,
  };
}
