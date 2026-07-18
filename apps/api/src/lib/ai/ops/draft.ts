import { z } from "zod";
import { gatewayExtract } from "../gateway";
import type { OpsDraftResult } from "./types";

const draftSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(10_000),
});

/**
 * Metered OPS_DRAFT call. Detectors themselves are free; only this drafts copy.
 * MOCK path injects __MOCK_JSON__ with the deterministic hint so tests stay stable.
 */
export async function draftOpsCopy(input: {
  organizationId: string;
  eventId: string;
  userId?: string | null;
  jobId?: string | null;
  detectorKind: string;
  triggerSummary: string;
  hint: OpsDraftResult;
}): Promise<{ draft: OpsDraftResult; metered: boolean; usageId: string | null }> {
  const mockPayload = JSON.stringify({ title: input.hint.title, body: input.hint.body });
  const extract = await gatewayExtract(draftSchema, [
    {
      role: "system",
      content:
        "You draft short organizer ops-inbox copy. Return JSON {title, body}. " +
        "Never decide to send — drafting only. Stay factual; no invented times or rooms.",
    },
    {
      role: "user",
      content:
        `Detector: ${input.detectorKind}\n` +
        `Summary: ${input.triggerSummary}\n` +
        `Suggested title: ${input.hint.title}\n` +
        `Suggested body: ${input.hint.body}\n\n` +
        `__MOCK_JSON__:${mockPayload}`,
    },
  ], {
    organizationId: input.organizationId,
    eventId: input.eventId,
    userId: input.userId,
    feature: "OPS_DRAFT",
    jobId: input.jobId,
  });

  if (extract.ok) {
    return {
      draft: { title: extract.data.title.trim(), body: extract.data.body.trim() },
      metered: true,
      usageId: extract.usageId,
    };
  }

  // Cap or provider failure — still surface the deterministic hint (unmetered fallback).
  return {
    draft: { title: input.hint.title, body: input.hint.body },
    metered: false,
    usageId: null,
  };
}
