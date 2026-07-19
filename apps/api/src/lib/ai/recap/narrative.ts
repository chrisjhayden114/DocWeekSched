/**
 * REPORT narrative via A0 gateway (feature RECAP) — placeholder substitution only.
 */

import { z } from "zod";
import { gatewayExtract } from "../gateway";
import type { RecapMetricsSnapshot } from "./types";
import { RecapSectionError } from "./types";
import {
  assertNoLiteralNumbersOutsidePlaceholders,
  substituteMetricPlaceholders,
} from "./placeholders";

const reportSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  narrativeMarkdown: z.string().min(1).max(50_000),
  citations: z.array(z.string().min(1).max(200)).max(200).optional(),
});

export type ReportDraftResult = {
  title: string;
  bodyMarkdown: string;
  metered: boolean;
  usageId: string | null;
};

export function finalizeReportNarrative(
  narrativeMarkdown: string,
  snapshot: RecapMetricsSnapshot,
  citations?: string[],
): string {
  assertNoLiteralNumbersOutsidePlaceholders(narrativeMarkdown);
  return substituteMetricPlaceholders(narrativeMarkdown, snapshot, citations);
}

function defaultNarrative(snapshot: RecapMetricsSnapshot): string {
  const lines = [
    `# Event recap`,
    ``,
    `Registrants: {{headline.registrants}}. Event check-ins: {{headline.checkIns}} (rate {{headline.checkInRate}}).`,
    `Adoption: {{headline.adoptionCount}} attendees ({{headline.adoptionRate}}).`,
    ``,
    `Engagement — Q&A threads {{engagement.qaThreads}}, upvotes {{engagement.qaUpvotes}}, poll votes {{engagement.pollVotes}},`,
    `community threads {{engagement.communityThreads}} / replies {{engagement.communityReplies}},`,
    `engagement points {{engagement.engagementPoints}}.`,
    ``,
    `Checked-in-by-mode figures are event check-in attributed via session join mode (not a per-session door scan).`,
  ];
  if (snapshot.topSessions[0]) {
    const id = snapshot.topSessions[0].sessionId;
    lines.push(``, `Top session joins: {{sessions.${id}.joinedTotal}}.`);
  }
  return lines.join("\n");
}

export async function draftReportNarrative(input: {
  organizationId: string;
  eventId: string;
  userId?: string | null;
  jobId?: string | null;
  eventName: string;
  snapshot: RecapMetricsSnapshot;
}): Promise<ReportDraftResult> {
  const fallback = defaultNarrative(input.snapshot);
  const mockPayload = JSON.stringify({
    title: `${input.eventName} — Recap report`,
    narrativeMarkdown: fallback,
    citations: [
      "headline.registrants",
      "headline.checkIns",
      "headline.checkInRate",
      "headline.adoptionCount",
      "headline.adoptionRate",
      "engagement.qaThreads",
      "engagement.qaUpvotes",
      "engagement.pollVotes",
      "engagement.communityThreads",
      "engagement.communityReplies",
      "engagement.engagementPoints",
      ...(input.snapshot.topSessions[0]
        ? [`sessions.${input.snapshot.topSessions[0].sessionId}.joinedTotal`]
        : []),
    ],
  });

  const extract = await gatewayExtract(reportSchema, [
    {
      role: "system",
      content:
        "You write a post-event recap REPORT narrative. Return JSON " +
        "{title?, narrativeMarkdown, citations?}. " +
        "EVERY number must be a {{metric.path}} placeholder from verifiedFigures — never invent or compute digits. " +
        "No free-text numbers. Drafting only; never send.",
    },
    {
      role: "user",
      content:
        `Event: ${input.eventName}\n` +
        `verifiedFigures:\n${JSON.stringify(input.snapshot)}\n\n` +
        `__MOCK_JSON__:${mockPayload}`,
    },
  ], {
    organizationId: input.organizationId,
    eventId: input.eventId,
    userId: input.userId,
    feature: "RECAP",
    jobId: input.jobId,
  });

  if (!extract.ok) {
    throw new RecapSectionError(
      extract.code === "CAP_EXCEEDED" ? "AI_CAP_EXCEEDED" : "AI_PROVIDER_ERROR",
      extract.message || "RECAP report draft failed",
    );
  }

  const narrative = extract.data.narrativeMarkdown.trim();
  const bodyMarkdown = finalizeReportNarrative(narrative, input.snapshot, extract.data.citations);

  return {
    title: (extract.data.title ?? `${input.eventName} — Recap report`).trim(),
    bodyMarkdown,
    metered: true,
    usageId: extract.usageId,
  };
}
