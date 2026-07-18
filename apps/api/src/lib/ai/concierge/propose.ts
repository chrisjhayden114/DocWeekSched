import { ConciergePendingActionStatus, Prisma } from "@prisma/client";
import type { ConciergePendingPreview, ConciergeToolName } from "@event-app/shared";
import { prisma } from "../../db";
import { HttpError } from "../../authorization";
import { buildEventGroundingContext } from "../grounding";
import { buildMutationPreview, executeMutatingTool, type ToolArgs } from "./tools";

export const PENDING_ACTION_TTL_MS = 30 * 60 * 1000;

export async function mintPendingAction(params: {
  eventId: string;
  userId: string;
  conversationId: string | null;
  tool: ConciergeToolName;
  args: ToolArgs;
  preview: ConciergePendingPreview;
}) {
  const expiresAt = new Date(Date.now() + PENDING_ACTION_TTL_MS);
  return prisma.conciergePendingAction.create({
    data: {
      eventId: params.eventId,
      userId: params.userId,
      conversationId: params.conversationId,
      tool: params.tool,
      args: params.args as Prisma.InputJsonValue,
      preview: params.preview as unknown as Prisma.InputJsonValue,
      status: ConciergePendingActionStatus.PENDING,
      expiresAt,
    },
  });
}

/**
 * Confirm a server-minted pending action.
 * Asserts PENDING + not expired + userId/eventId match the **server session** —
 * never trusts model output or client-supplied tool args for execution.
 */
export async function confirmPendingAction(params: {
  pendingActionId: string;
  /** From JWT / AuthedRequest — not from the model. */
  userId: string;
  /** From resolveEventFromRequest / access check — not from the model. */
  eventId: string;
}) {
  const row = await prisma.conciergePendingAction.findUnique({
    where: { id: params.pendingActionId },
  });
  if (!row) throw new HttpError(404, { error: "Pending action not found" });

  if (row.userId !== params.userId) {
    throw new HttpError(403, { error: "Cannot confirm another user’s action" });
  }
  if (row.eventId !== params.eventId) {
    throw new HttpError(403, { error: "Pending action is for a different event" });
  }

  if (row.status !== ConciergePendingActionStatus.PENDING) {
    throw new HttpError(409, { error: `Action is ${row.status.toLowerCase()}`, status: row.status });
  }

  if (row.expiresAt.getTime() <= Date.now()) {
    await prisma.conciergePendingAction.update({
      where: { id: row.id },
      data: { status: ConciergePendingActionStatus.EXPIRED },
    });
    throw new HttpError(410, { error: "This action expired — ask Concierge again" });
  }

  const grounding = await buildEventGroundingContext(params.eventId, { userId: params.userId });
  const result = await executeMutatingTool({
    tool: row.tool as ConciergeToolName,
    args: (row.args && typeof row.args === "object" ? row.args : {}) as ToolArgs,
    eventId: params.eventId,
    userId: params.userId,
    grounding,
  });

  await prisma.conciergePendingAction.update({
    where: { id: row.id },
    data: {
      status: ConciergePendingActionStatus.CONFIRMED,
      confirmedAt: new Date(),
    },
  });

  return { result, pendingActionId: row.id, tool: row.tool };
}

export async function proposeMutation(params: {
  eventId: string;
  userId: string;
  conversationId: string | null;
  tool: ConciergeToolName;
  args: ToolArgs;
  grounding: Awaited<ReturnType<typeof buildEventGroundingContext>>;
}) {
  const preview = await buildMutationPreview(
    params.grounding,
    params.tool,
    params.args,
    params.userId,
  );
  const row = await mintPendingAction({
    eventId: params.eventId,
    userId: params.userId,
    conversationId: params.conversationId,
    tool: params.tool,
    args: params.args,
    preview,
  });
  return {
    pendingActionId: row.id,
    tool: params.tool,
    preview,
    expiresAt: row.expiresAt.toISOString(),
  };
}
