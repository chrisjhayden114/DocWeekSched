/**
 * CERTIFICATES section — enqueue P4 batch_issue with sendReadyEmail:false.
 * Regeneration uses the same idempotent upsert (publicId/issuedAt never change).
 */

import { prisma } from "../../db";
import { enqueueCertificateBatchIssue } from "../../certificates";
import type { RecapMetricsSnapshot } from "./types";
import { substituteMetricPlaceholders } from "./placeholders";

export type CertificatesSectionResult = {
  title: string;
  bodyMarkdown: string;
  structured: {
    templateIds: string[];
    batchJobIds: string[];
    note: string;
  };
};

export async function runCertificatesSection(input: {
  organizationId: string;
  eventId: string;
  createdById: string;
  eventName: string;
  snapshot: RecapMetricsSnapshot;
  /** When true (regeneration), still enqueue batch jobs — P4 upsert keeps publicId/issuedAt. */
  isRegeneration: boolean;
}): Promise<CertificatesSectionResult> {
  const templates = await prisma.certificateTemplate.findMany({
    where: { eventId: input.eventId, organizationId: input.organizationId },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });

  const batchJobIds: string[] = [];
  for (const t of templates) {
    const job = await enqueueCertificateBatchIssue({
      certificateTemplateId: t.id,
      organizationId: input.organizationId,
      eventId: input.eventId,
      createdById: input.createdById,
      sendReadyEmail: false,
    });
    batchJobIds.push(job.id);
  }

  const note = input.isRegeneration
    ? "Regeneration re-ran batch issue with sendReadyEmail:false; publicId/issuedAt stay stable via P4 upsert."
    : "Certificates issued via P4 batch_issue with sendReadyEmail:false. Availability email is a separate draft.";

  const bodyMarkdown = [
    `# Certificates`,
    ``,
    templates.length === 0
      ? `No certificate templates configured for this event.`
      : `Queued batch issue for ${templates.length} template(s): ${templates.map((t) => t.name).join(", ")}.`,
    ``,
    `Eligible attendees: based on template rules. Event check-ins in metrics: {{headline.checkIns}}.`,
    ``,
    note,
  ].join("\n");

  const rendered = substituteMetricPlaceholders(bodyMarkdown, input.snapshot, ["headline.checkIns"]);

  return {
    title: `${input.eventName} — Certificates`,
    bodyMarkdown: rendered,
    structured: {
      templateIds: templates.map((t) => t.id),
      batchJobIds,
      note,
    },
  };
}
