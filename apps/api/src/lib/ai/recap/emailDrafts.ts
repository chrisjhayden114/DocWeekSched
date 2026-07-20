/**
 * Draft certificate-availability + thank-you emails (never send from generate).
 * Event names and numbers enter subject/body only via metricsSnapshot placeholders.
 */

import { z } from "zod";
import { gatewayExtract } from "../gateway";
import type { RecapMetricsSnapshot } from "./types";
import { RecapSectionError } from "./types";
import {
  assertNoLiteralNumbersOutsidePlaceholders,
  substituteMetricPlaceholders,
} from "./placeholders";

const emailSchema = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(20_000),
  citations: z.array(z.string().min(1).max(200)).max(50).optional(),
});

export type RecapEmailDraft = {
  kind: "CERTIFICATE_AVAILABILITY" | "THANK_YOU_ATTENDEE" | "THANK_YOU_SPEAKER";
  audienceRole: string | null;
  subject: string;
  body: string;
  metered: boolean;
};

/** Fallback copy — {{event.name}} and metric paths only; zero literal digits. */
function fallbackEmail(kind: RecapEmailDraft["kind"]): {
  subject: string;
  body: string;
  citations: string[];
} {
  if (kind === "CERTIFICATE_AVAILABILITY") {
    return {
      subject: `Your certificate from {{event.name}}`,
      body:
        `Thank you for attending {{event.name}}.\n\n` +
        `Your certificate of participation is ready to download from your event profile.\n\n` +
        `Event check-ins recorded: {{headline.checkIns}} of {{headline.registrants}} registrants.`,
      citations: ["event.name", "headline.checkIns", "headline.registrants"],
    };
  }
  if (kind === "THANK_YOU_ATTENDEE") {
    return {
      subject: `Thank you for joining {{event.name}}`,
      body:
        `Thank you for being part of {{event.name}}.\n\n` +
        `Together we saw {{headline.adoptionCount}} active attendees ` +
        `(adoption {{headline.adoptionRate}}) and {{engagement.qaThreads}} Q&A threads.\n\n` +
        `We hope to see you at the next edition.`,
      citations: [
        "event.name",
        "headline.adoptionCount",
        "headline.adoptionRate",
        "engagement.qaThreads",
      ],
    };
  }
  return {
    subject: `Thank you for speaking at {{event.name}}`,
    body:
      `Thank you for sharing your work at {{event.name}}.\n\n` +
      `Attendees engaged with {{engagement.pollVotes}} poll votes and ` +
      `{{engagement.communityThreads}} community threads across the program.\n\n` +
      `We appreciate your contribution.`,
    citations: ["event.name", "engagement.pollVotes", "engagement.communityThreads"],
  };
}

async function draftOne(input: {
  organizationId: string;
  eventId: string;
  userId?: string | null;
  jobId?: string | null;
  snapshot: RecapMetricsSnapshot;
  kind: RecapEmailDraft["kind"];
}): Promise<RecapEmailDraft> {
  const fb = fallbackEmail(input.kind);
  const mockPayload = JSON.stringify({
    subject: fb.subject,
    body: fb.body,
    citations: fb.citations,
  });

  const extract = await gatewayExtract(emailSchema, [
    {
      role: "system",
      content:
        "You draft a short post-event email. Return JSON {subject, body, citations?}. " +
        "Every number and the event name must use {{metric.path}} placeholders " +
        "(e.g. {{event.name}}, {{headline.checkIns}}) — never invent digits or inline the event name. " +
        "Drafting only; never send.",
    },
    {
      role: "user",
      content:
        `Kind: ${input.kind}\n` +
        `(Use {{event.name}} for the event name — do not copy a literal name.)\n` +
        `verifiedFigures:\n${JSON.stringify({
          event: input.snapshot.event,
          headline: input.snapshot.headline,
          engagement: input.snapshot.engagement,
        })}\n\n` +
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
      extract.message || `RECAP email draft failed (${input.kind})`,
    );
  }

  assertNoLiteralNumbersOutsidePlaceholders(extract.data.subject);
  assertNoLiteralNumbersOutsidePlaceholders(extract.data.body);
  const subject = substituteMetricPlaceholders(
    extract.data.subject.trim(),
    input.snapshot,
    extract.data.citations,
  );
  const body = substituteMetricPlaceholders(
    extract.data.body.trim(),
    input.snapshot,
    extract.data.citations,
  );

  const audienceRole =
    input.kind === "THANK_YOU_SPEAKER"
      ? "SPEAKER"
      : input.kind === "THANK_YOU_ATTENDEE"
        ? "ATTENDEE"
        : null;

  return {
    kind: input.kind,
    audienceRole,
    subject,
    body,
    metered: true,
  };
}

export async function draftRecapEmails(input: {
  organizationId: string;
  eventId: string;
  userId?: string | null;
  jobId?: string | null;
  eventName: string;
  snapshot: RecapMetricsSnapshot;
}): Promise<RecapEmailDraft[]> {
  const kinds: RecapEmailDraft["kind"][] = [
    "CERTIFICATE_AVAILABILITY",
    "THANK_YOU_ATTENDEE",
    "THANK_YOU_SPEAKER",
  ];
  const out: RecapEmailDraft[] = [];
  for (const kind of kinds) {
    out.push(
      await draftOne({
        organizationId: input.organizationId,
        eventId: input.eventId,
        userId: input.userId,
        jobId: input.jobId,
        snapshot: input.snapshot,
        kind,
      }),
    );
  }
  return out;
}
