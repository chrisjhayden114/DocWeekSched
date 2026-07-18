import type { OpsInboxCard, Prisma } from "@prisma/client";
import { prisma } from "../../db";
import { writeAuditLog } from "../audit";
import { draftOpsCopy } from "./draft";
import type { CreateOpsCardInput } from "./types";

/**
 * Idempotent card create keyed on (eventId, triggerInstanceKey).
 * If any row already exists (OPEN / APPLIED / DISMISSED), skip — sticky dismiss.
 * Never applies or sends.
 */
export async function createOpsCardIfAbsent(
  input: CreateOpsCardInput,
  opts?: { jobId?: string | null; actorUserId?: string | null },
): Promise<{ card: OpsInboxCard | null; created: boolean }> {
  const existing = await prisma.opsInboxCard.findUnique({
    where: {
      eventId_triggerInstanceKey: {
        eventId: input.eventId,
        triggerInstanceKey: input.triggerInstanceKey,
      },
    },
  });
  if (existing) {
    return { card: existing, created: false };
  }

  const { draft, metered } = await draftOpsCopy({
    organizationId: input.organizationId,
    eventId: input.eventId,
    userId: opts?.actorUserId,
    jobId: opts?.jobId,
    detectorKind: input.detectorKind,
    triggerSummary: input.triggerSummary,
    hint: input.draftHint,
  });

  try {
    const card = await prisma.opsInboxCard.create({
      data: {
        organizationId: input.organizationId,
        eventId: input.eventId,
        detectorKind: input.detectorKind,
        triggerInstanceKey: input.triggerInstanceKey,
        status: "OPEN",
        triggerSummary: input.triggerSummary,
        evidence: input.evidence as Prisma.InputJsonValue,
        draftActionType: input.draftActionType,
        draftTitle: draft.title,
        draftBody: draft.body,
        draftPayload: input.draftPayload as Prisma.InputJsonValue,
        draftMetered: metered,
      },
    });

    await writeAuditLog({
      organizationId: input.organizationId,
      eventId: input.eventId,
      actorUserId: opts?.actorUserId,
      action: "AI_DRAFT",
      entityType: "OpsInboxCard",
      entityId: card.id,
      aiGenerated: true,
      payload: {
        detectorKind: input.detectorKind,
        triggerInstanceKey: input.triggerInstanceKey,
        draftMetered: metered,
      },
    });

    return { card, created: true };
  } catch (err) {
    // Race on unique key — treat as skip (idempotent).
    const again = await prisma.opsInboxCard.findUnique({
      where: {
        eventId_triggerInstanceKey: {
          eventId: input.eventId,
          triggerInstanceKey: input.triggerInstanceKey,
        },
      },
    });
    if (again) return { card: again, created: false };
    throw err;
  }
}

export async function listOpsCards(
  eventId: string,
  opts?: { status?: "OPEN" | "APPLIED" | "DISMISSED" | "ALL" },
): Promise<OpsInboxCard[]> {
  const status = opts?.status && opts.status !== "ALL" ? opts.status : undefined;
  return prisma.opsInboxCard.findMany({
    where: {
      eventId,
      ...(status ? { status } : {}),
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
}

export async function dismissOpsCard(input: {
  cardId: string;
  eventId: string;
  actorUserId: string;
}): Promise<OpsInboxCard> {
  const card = await prisma.opsInboxCard.findFirst({
    where: { id: input.cardId, eventId: input.eventId },
  });
  if (!card) {
    throw Object.assign(new Error("Ops card not found"), { status: 404 });
  }
  if (card.status === "DISMISSED") return card;

  return prisma.opsInboxCard.update({
    where: { id: card.id },
    data: {
      status: "DISMISSED",
      dismissedAt: new Date(),
      dismissedById: input.actorUserId,
    },
  });
}

export async function editOpsCard(input: {
  cardId: string;
  eventId: string;
  draftTitle?: string;
  draftBody?: string;
  draftPayload?: Record<string, unknown>;
}): Promise<OpsInboxCard> {
  const card = await prisma.opsInboxCard.findFirst({
    where: { id: input.cardId, eventId: input.eventId, status: "OPEN" },
  });
  if (!card) {
    throw Object.assign(new Error("Open ops card not found"), { status: 404 });
  }
  return prisma.opsInboxCard.update({
    where: { id: card.id },
    data: {
      ...(input.draftTitle !== undefined ? { draftTitle: input.draftTitle.trim() } : {}),
      ...(input.draftBody !== undefined ? { draftBody: input.draftBody.trim() } : {}),
      ...(input.draftPayload !== undefined
        ? { draftPayload: input.draftPayload as Prisma.InputJsonValue }
        : {}),
    },
  });
}
