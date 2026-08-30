/**
 * W-3 — resolve FEATURES / PLAN / READINESS at prompt-build time.
 * Prisma lives here so organizerState.ts stays a pure serializer.
 */

import { PLAN_BY_SKU, defaultSkuForTier, type PlanSkuKey } from "@event-app/shared";
import { effectiveAttendeeCap, limit } from "../../billing";
import { prisma } from "../../db";
import { buildFeatureState, loadFeatureOverrides } from "../../features";
import {
  rollupReadinessTemplates,
  type OrganizerStateExtras,
} from "./organizerState";

export async function loadOrganizerStateExtras(params: {
  eventId: string;
  organizationId: string;
  registered: number;
}): Promise<OrganizerStateExtras> {
  const { eventId, organizationId, registered } = params;

  const [
    features,
    attendeesLimit,
    readinessPresentersLimit,
    outreachProspectsLimit,
    org,
    templates,
    assignmentRows,
    outreachProspectsUsed,
  ] = await Promise.all([
    loadFeatureOverrides(eventId).then((overrides) => buildFeatureState(overrides, organizationId)),
    effectiveAttendeeCap(eventId),
    limit(organizationId, "readinessPresentersPerEvent"),
    limit(organizationId, "outreachProspectsPerEvent"),
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { plan: true, planSku: true },
    }),
    prisma.readinessTemplate.findMany({
      where: { eventId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, name: true },
    }),
    prisma.readinessAssignment.findMany({
      where: { eventId },
      select: {
        speakerId: true,
        sessionId: true,
        status: true,
        requirement: { select: { templateId: true } },
      },
    }),
    prisma.sponsorProspect.count({ where: { eventId } }),
  ]);

  const storedSku =
    org?.planSku && org.planSku in PLAN_BY_SKU ? (org.planSku as PlanSkuKey) : defaultSkuForTier(org?.plan);
  const readinessPresentersUsed = new Set(
    assignmentRows.map((row) => row.speakerId).filter((id): id is string => Boolean(id)),
  ).size;

  return {
    features: features.map((row) => ({ key: row.key, enabled: row.enabled })),
    plan: {
      name: PLAN_BY_SKU[storedSku].name,
      attendeesUsed: registered,
      attendeesLimit,
      readinessPresentersUsed,
      readinessPresentersLimit,
      outreachProspectsUsed,
      outreachProspectsLimit,
    },
    readiness: rollupReadinessTemplates(
      templates,
      assignmentRows.map((row) => ({
        templateId: row.requirement.templateId,
        speakerId: row.speakerId,
        sessionId: row.sessionId,
        status: row.status,
      })),
    ),
  };
}
