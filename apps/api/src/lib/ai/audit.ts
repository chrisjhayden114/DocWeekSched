import type { AuditAction, Prisma } from "@prisma/client";
import { prisma } from "../db";

export async function writeAuditLog(input: {
  organizationId?: string | null;
  eventId?: string | null;
  actorUserId?: string | null;
  action: AuditAction;
  entityType?: string | null;
  entityId?: string | null;
  aiGenerated?: boolean;
  payload?: Prisma.InputJsonValue;
}): Promise<{ id: string }> {
  const row = await prisma.auditLog.create({
    data: {
      organizationId: input.organizationId ?? null,
      eventId: input.eventId ?? null,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      aiGenerated: input.aiGenerated ?? false,
      payload: input.payload ?? {},
    },
  });
  return { id: row.id };
}
