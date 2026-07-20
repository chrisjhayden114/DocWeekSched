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

/**
 * Mock / fallback report — every name, title, and number is a {{path}} placeholder.
 * Free text must contain zero literal digits.
 */
function defaultNarrative(snapshot: RecapMetricsSnapshot): string {
  const lines = [
    `# {{event.name}}`,
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
    lines.push(
      ``,
      `Top session {{topSessions.0.title}} ({{sessions.${id}.title}}) joins: {{sessions.${id}.joinedTotal}}.`,
    );
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
  const citations = [
    "event.name",
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
      ? [
          "topSessions.0.title",
          `sessions.${input.snapshot.topSessions[0].sessionId}.title`,
          `sessions.${input.snapshot.topSessions[0].sessionId}.joinedTotal`,
        ]
      : []),
  ];
  const mockPayload = JSON.stringify({
    title: "{{event.name}} — Recap report",
    narrativeMarkdown: fallback,
    citations,
  });

  const extract = await gatewayExtract(reportSchema, [
    {
      role: "system",
      content:
        "You write a post-event recap REPORT narrative. Return JSON " +
        "{title?, narrativeMarkdown, citations?}. " +
        "EVERY number AND every event/session name or title must be a {{metric.path}} placeholder " +
        "from verifiedFigures (e.g. {{event.name}}, {{sessions.<id>.title}}, {{topSessions.0.title}}, {{headline.registrants}}). " +
        "Never inline names, titles, or digits in free text. No free-text numbers. Drafting only; never send.",
    },
    {
      role: "user",
      content:
        `Event id: ${input.eventId}\n` +
        `(Use {{event.name}} for the event name — do not copy a literal name into the narrative.)\n` +
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

  const rawTitle = (extract.data.title ?? "{{event.name}} — Recap report").trim();
  assertNoLiteralNumbersOutsidePlaceholders(rawTitle);
  const title = substituteMetricPlaceholders(rawTitle, input.snapshot, ["event.name"]);

  return {
    title,
    bodyMarkdown,
    metered: true,
    usageId: extract.usageId,
  };
}
