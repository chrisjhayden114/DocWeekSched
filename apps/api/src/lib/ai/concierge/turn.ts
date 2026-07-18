import { ConciergeMessageRole, Prisma } from "@prisma/client";
import type { ConciergeActionCard } from "@event-app/shared";
import { prisma } from "../../db";
import { gatewayChat } from "../gateway";
import { buildEventGroundingContext } from "../grounding";
import { runConciergeDialogue } from "./dialogue";
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

export type ConciergeTurnResponse = {
  conversationId: string;
  assistantMessage: string;
  aiGenerated: true;
  actionCards: ConciergeActionCard[];
  mapHint: { roomId: string; mapId?: string | null; label: string } | null;
  handoff: { agent: "A4"; message: string } | null;
  refused: boolean;
  usageId?: string;
  teaser?: { kind: "FREE_CAP"; message: string; upgrade?: unknown } | null;
};

/**
 * One attendee turn: ground → dialogue (user text only) → meter via A0 → mint pending → persist.
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

  await prisma.conciergeMessage.create({
    data: {
      conversationId: conversation.id,
      role: ConciergeMessageRole.USER,
      body: userMessage.slice(0, 4000),
      aiGenerated: false,
    },
  });

  const dialogue = await runConciergeDialogue({
    userText: userMessage,
    grounding,
    userId,
  });

  // Meter through A0 before minting pending actions (mock returns canned; enforces CONCIERGE caps)
  const gw = await gatewayChat([{ role: "user", content: dialogue.gatewayUserPrompt }], {
    organizationId,
    eventId,
    userId,
    feature: "CONCIERGE",
  });

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
      refused: false,
      teaser: { kind: "FREE_CAP", message: teaserMessage, upgrade: gw.upgrade },
    };
  }

  const actionCards: ConciergeActionCard[] = [];
  for (const proposal of dialogue.mutationProposals) {
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

  const assistantMessage = dialogue.assistantMessage;
  const pendingIds = actionCards.map((c) => c.pendingActionId);

  await prisma.conciergeMessage.create({
    data: {
      conversationId: conversation.id,
      role: ConciergeMessageRole.ASSISTANT,
      body: assistantMessage,
      aiGenerated: true,
      toolProposals: dialogue.mutationProposals.length
        ? (dialogue.mutationProposals as unknown as Prisma.InputJsonValue)
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
    mapHint: dialogue.mapHint,
    handoff: dialogue.handoff,
    refused: dialogue.refused,
    usageId: gw.ok ? gw.usageId : undefined,
    teaser: null,
  };
}
