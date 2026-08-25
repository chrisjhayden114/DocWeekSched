/**
 * TALK-1 — create the seeded Speaker pack template from the shared definition.
 * Never auto-runs; the organizer presses the offer button.
 */

import { Prisma } from "@prisma/client";
import {
  SPEAKER_PACK_REQUIREMENTS,
  SPEAKER_PACK_TEMPLATE_NAME,
  shouldOfferSpeakerPack,
  type FeatureKey,
  type FeatureOverrideValue,
} from "@event-app/shared";
import { HttpError } from "../authorization";
import { prisma } from "../db";
import { loadFeatureOverrides } from "../features";

export { SPEAKER_PACK_REQUIREMENTS, SPEAKER_PACK_TEMPLATE_NAME };

export async function readSetupEventType(eventId: string): Promise<string | null> {
  const log = await prisma.auditLog.findFirst({
    where: { eventId, entityType: "setup_copilot_complete" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { payload: true },
  });
  const payload = log?.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const form = (payload as { form?: { eventType?: unknown } }).form;
  return typeof form?.eventType === "string" && form.eventType ? form.eventType : null;
}

export async function speakerPackOfferForEvent(
  eventId: string,
  templateCount: number,
  overrides?: Partial<Record<FeatureKey, FeatureOverrideValue>>,
): Promise<boolean> {
  if (templateCount > 0) return false;
  const featureOverrides = overrides ?? (await loadFeatureOverrides(eventId));
  const setupEventType = await readSetupEventType(eventId);
  return shouldOfferSpeakerPack({
    templateCount,
    overrides: featureOverrides,
    setupEventType,
  });
}

export async function createSpeakerPackTemplate(eventId: string, organizationId: string) {
  const existing = await prisma.readinessTemplate.findFirst({
    where: { eventId, name: SPEAKER_PACK_TEMPLATE_NAME },
  });
  if (existing) {
    throw new HttpError(400, { error: "A template with that name already exists" });
  }

  return prisma.$transaction(async (tx) => {
    const template = await tx.readinessTemplate.create({
      data: {
        eventId,
        organizationId,
        name: SPEAKER_PACK_TEMPLATE_NAME,
        description: "Materials every speaker owes before show day.",
      },
    });
    const requirements = [];
    for (const [i, req] of SPEAKER_PACK_REQUIREMENTS.entries()) {
      requirements.push(
        await tx.readinessRequirement.create({
          data: {
            templateId: template.id,
            eventId,
            label: req.label,
            kind: req.kind,
            helpText: req.helpText?.trim() || null,
            config: (req.config ?? {}) as Prisma.InputJsonValue,
            required: req.required ?? true,
            dueAt: null,
            sortOrder: i,
          },
        }),
      );
    }
    return { ...template, requirements };
  });
}
