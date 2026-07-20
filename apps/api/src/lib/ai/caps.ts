import type { AiMeterFeature } from "@prisma/client";
import type { LimitKey } from "@event-app/shared";
import { HttpError } from "../authorization";
import { limit, upgradePayload } from "../billing/entitlements";
import { countAiUsage } from "./metering";

function featureToLimitKey(feature: AiMeterFeature): LimitKey | null {
  switch (feature) {
    case "AGENDA_INGEST":
      return "aiIngestPerEvent";
    case "CONCIERGE":
      return "aiConciergePerEvent";
    default:
      // Soft-metered features: only hard abuse caps apply
      return null;
  }
}

function hardCapFor(feature: AiMeterFeature): number | null {
  if (feature === "AGENDA_INGEST") {
    const n = Number(process.env.AI_HARD_CAP_INGEST_PER_EVENT || 100);
    return Number.isFinite(n) && n > 0 ? n : 100;
  }
  if (feature === "CONCIERGE") {
    const n = Number(process.env.AI_HARD_CAP_CONCIERGE_PER_EVENT || 10_000);
    return Number.isFinite(n) && n > 0 ? n : 10_000;
  }
  const n = Number(process.env.AI_HARD_CAP_OTHER_PER_EVENT || 10_000);
  return Number.isFinite(n) && n > 0 ? n : 10_000;
}

/**
 * Enforce plan + hard abuse caps from AiUsageRecord counts.
 * Throws HttpError 402 with typed PLAN_LIMIT upgrade payload.
 */
export async function assertAiCap(
  organizationId: string,
  eventId: string,
  feature: AiMeterFeature,
): Promise<void> {
  const used = await countAiUsage({ organizationId, eventId, feature });
  const limitKey = featureToLimitKey(feature);
  const planMax = limitKey ? await limit(organizationId, limitKey) : null;
  const hard = hardCapFor(feature);

  const effectiveMax =
    planMax == null ? hard : hard == null ? planMax : Math.min(planMax, hard);

  if (effectiveMax == null) return;
  if (used < effectiveMax) return;

  throw new HttpError(402, {
    error:
      feature === "AGENDA_INGEST"
        ? `Your plan allows ${effectiveMax} agenda ingest${effectiveMax === 1 ? "" : "s"} for this event. Upgrade to run more.`
        : feature === "CONCIERGE"
          ? `Your plan allows ${effectiveMax} concierge messages for this event. Upgrade for more.`
          : `AI usage limit reached for this event (${used}/${effectiveMax}).`,
    upgrade: upgradePayload({
      code: "PLAN_LIMIT",
      message: `AI ${feature} limit reached (${used}/${effectiveMax}).`,
      limitKey: limitKey ?? undefined,
      current: used,
      max: effectiveMax,
      suggestedSkus: ["per_event_250", "pro_monthly", "pro_annual"],
    }),
  });
}
