/**
 * Draft certificate-availability + thank-you emails (never send from generate).
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

function fallbackEmail(
  kind: RecapEmailDraft["kind"],
  eventName: string,
): { subject: string; body: string; citations: string[] } {
  if (kind === "CERTIFICATE_AVAILABILITY") {
    return {
      subject: `Your certificate from ${eventName}`,
      body:
        `Thank you for attending ${eventName}.\n\n` +
        `Your certificate of participation is ready to download from your event profile.\n\n` +
        `Event check-ins recorded: {{headline.checkIns}} of {{headline.registrants}} registrants.`,
      citations: ["headline.checkIns", "headline.registrants"],
    };
  }
  if (kind === "THANK_YOU_ATTENDEE") {
    return {
      subject: `Thank you for joining ${eventName}`,
      body:
        `Thank you for being part of ${eventName}.\n\n` +
        `Together we saw {{headline.adoptionCount}} active attendees ` +
        `(adoption {{headline.adoptionRate}}) and {{engagement.qaThreads}} Q&A threads.\n\n` +
        `We hope to see you at the next edition.`,
      citations: ["headline.adoptionCount", "headline.adoptionRate", "engagement.qaThreads"],
    };
  }
  return {
    subject: `Thank you for speaking at ${eventName}`,
    body:
      `Thank you for sharing your work at ${eventName}.\n\n` +
      `Attendees engaged with {{engagement.pollVotes}} poll votes and ` +
      `{{engagement.communityThreads}} community threads across the program.\n\n` +
      `We appreciate your contribution.`,
    citations: ["engagement.pollVotes", "engagement.communityThreads"],
  };
}

async function draftOne(input: {
  organizationId: string;
  eventId: string;
  userId?: string | null;
  jobId?: string | null;
  eventName: string;
  snapshot: RecapMetricsSnapshot;
  kind: RecapEmailDraft["kind"];
}): Promise<RecapEmailDraft> {
  const fb = fallbackEmail(input.kind, input.eventName);
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
        "Numbers must use {{metric.path}} placeholders only — never invent digits. Drafting only; never send.",
    },
    {
      role: "user",
      content:
        `Kind: ${input.kind}\nEvent: ${input.eventName}\n` +
        `verifiedFigures:\n${JSON.stringify({
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

  assertNoLiteralNumbersOutsidePlaceholders(extract.data.body);
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
    subject: extract.data.subject.trim(),
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
    out.push(await draftOne({ ...input, kind }));
  }
  return out;
}
