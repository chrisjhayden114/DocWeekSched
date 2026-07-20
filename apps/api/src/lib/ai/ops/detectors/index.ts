import { detectCapacityPressure } from "./capacity";
import { detectDailyDigest } from "./dailyDigest";
import { detectLowCheckin } from "./lowCheckin";
import { detectModeration } from "./moderation";
import { detectQaStale } from "./qaStale";
import { detectSessionChanged } from "./sessionChanged";
import type { DetectorRunResult } from "../types";
import { isOpsInboxActive } from "../window";
import { featureEnabled } from "../../../features/featureEnabled";
import { prisma } from "../../../db";

export {
  detectSessionChanged,
  detectQaStale,
  detectLowCheckin,
  detectCapacityPressure,
  detectModeration,
  detectDailyDigest,
};

/**
 * Run all deterministic detectors for one event. Never applies/sends cards.
 * Detector execution itself is unmetered; drafting inside createOpsCardIfAbsent is metered.
 */
export async function runOpsDetectorsForEvent(
  eventId: string,
  opts?: { jobId?: string | null; now?: Date; forceDigest?: boolean },
): Promise<{
  active: boolean;
  results: DetectorRunResult[];
  createdTotal: number;
}> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      organizationId: true,
      startDate: true,
      endDate: true,
      status: true,
    },
  });
  if (!event || event.status === "ARCHIVED") {
    return { active: false, results: [], createdTotal: 0 };
  }
  if (!(await featureEnabled(eventId, "ops_agent"))) {
    return { active: false, results: [], createdTotal: 0 };
  }
  const now = opts?.now || new Date();
  if (!isOpsInboxActive(event, now)) {
    return { active: false, results: [], createdTotal: 0 };
  }

  const orgId = event.organizationId;
  const results: DetectorRunResult[] = [];
  results.push(await detectSessionChanged(eventId, orgId, { jobId: opts?.jobId, now }));
  results.push(await detectQaStale(eventId, orgId, { jobId: opts?.jobId, now }));
  results.push(await detectLowCheckin(eventId, orgId, { jobId: opts?.jobId, now }));
  results.push(await detectCapacityPressure(eventId, orgId, { jobId: opts?.jobId, now }));
  results.push(await detectModeration(eventId, orgId, { jobId: opts?.jobId, now }));
  results.push(
    await detectDailyDigest(eventId, orgId, {
      jobId: opts?.jobId,
      now,
      force: opts?.forceDigest,
    }),
  );

  return {
    active: true,
    results,
    createdTotal: results.reduce((n, r) => n + r.created, 0),
  };
}
