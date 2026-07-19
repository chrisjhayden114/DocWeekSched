/**
 * Generate / regenerate EventRecap workspace.
 * Drafts only — never calls email provider or announcement publish.
 */

import type { Prisma } from "@prisma/client";
import {
  RecapEmailStatus,
  RecapSectionStatus,
  RecapStatus,
} from "@prisma/client";
import { prisma } from "../../db";
import { featureEnabled } from "../../features";
import { computeRecapMetrics } from "./metrics";
import { buildFeedbackQuoteBank } from "./quotes";
import { draftReportNarrative } from "./narrative";
import { draftFeedbackSynthesis } from "./synthesis";
import { draftRecapEmails } from "./emailDrafts";
import { runCertificatesSection } from "./certSection";
import { buildSponsorOnePagers } from "./sponsors";
import { applyFixNextYearToSeries } from "./series";
import { RecapSectionError } from "./types";

export type GenerateRecapInput = {
  eventId: string;
  organizationId: string;
  createdById: string;
  jobId?: string | null;
};

export type GenerateRecapResult = {
  recapId: string;
  status: RecapStatus;
  regenerated: boolean;
};

async function assertRecapAllowed(eventId: string): Promise<void> {
  if (!(await featureEnabled(eventId, "recap_agent"))) {
    throw new RecapSectionError("FEATURE_DISABLED", "recap_agent is not available for this event");
  }
}

export async function generateEventRecap(input: GenerateRecapInput): Promise<GenerateRecapResult> {
  await assertRecapAllowed(input.eventId);

  const event = await prisma.event.findUnique({
    where: { id: input.eventId },
    select: {
      id: true,
      name: true,
      organizationId: true,
      endDate: true,
      seriesId: true,
    },
  });
  if (!event || event.organizationId !== input.organizationId) {
    throw new RecapSectionError("EVENT_NOT_FOUND", "Event not found");
  }
  if (Date.now() < event.endDate.getTime()) {
    throw new RecapSectionError("EVENT_NOT_ENDED", "Recap can only be generated after the event endDate");
  }

  let recap = await prisma.eventRecap.findUnique({ where: { eventId: event.id } });
  const priorGeneratedAt = recap?.generatedAt ?? null;
  const isRegeneration = Boolean(recap && (recap.status === RecapStatus.READY || priorGeneratedAt));

  if (!recap) {
    recap = await prisma.eventRecap.create({
      data: {
        organizationId: event.organizationId,
        eventId: event.id,
        status: RecapStatus.GENERATING,
        lastJobId: input.jobId ?? null,
      },
    });
  } else {
    await prisma.eventRecap.update({
      where: { id: recap.id },
      data: {
        status: RecapStatus.GENERATING,
        lastJobId: input.jobId ?? null,
      },
    });
  }

  try {
    const snapshot = await computeRecapMetrics(event.id);
    const quoteBank = await buildFeedbackQuoteBank(event.id);

    const report = await draftReportNarrative({
      organizationId: event.organizationId,
      eventId: event.id,
      userId: input.createdById,
      jobId: input.jobId,
      eventName: event.name,
      snapshot,
    });

    const synthesis = await draftFeedbackSynthesis({
      organizationId: event.organizationId,
      eventId: event.id,
      userId: input.createdById,
      jobId: input.jobId,
      eventName: event.name,
      quoteBank,
    });

    const certs = await runCertificatesSection({
      organizationId: event.organizationId,
      eventId: event.id,
      createdById: input.createdById,
      eventName: event.name,
      snapshot,
      isRegeneration,
    });

    const emails = await draftRecapEmails({
      organizationId: event.organizationId,
      eventId: event.id,
      userId: input.createdById,
      jobId: input.jobId,
      eventName: event.name,
      snapshot,
    });

    const sponsorPages = await buildSponsorOnePagers(event.id);

    // Supersede live DRAFT sections; leave SUPERSEDED history.
    await prisma.eventRecapSection.updateMany({
      where: { recapId: recap.id, status: RecapSectionStatus.DRAFT },
      data: { status: RecapSectionStatus.SUPERSEDED },
    });

    // Supersede DRAFT emails only — never touch SENT.
    await prisma.eventRecapEmail.updateMany({
      where: { recapId: recap.id, status: RecapEmailStatus.DRAFT },
      data: { status: RecapEmailStatus.SUPERSEDED },
    });

    await prisma.eventRecapSection.create({
      data: {
        recapId: recap.id,
        kind: "REPORT",
        status: RecapSectionStatus.DRAFT,
        title: report.title,
        bodyMarkdown: report.bodyMarkdown,
        structured: { metricsPathsUsed: true } as Prisma.InputJsonValue,
        aiGenerated: true,
        metered: report.metered,
      },
    });

    await prisma.eventRecapSection.create({
      data: {
        recapId: recap.id,
        kind: "FEEDBACK_SYNTHESIS",
        status: RecapSectionStatus.DRAFT,
        title: synthesis.title,
        bodyMarkdown: synthesis.bodyMarkdown,
        structured: {
          themes: synthesis.themes,
          fixNextYear: synthesis.fixNextYear,
        } as unknown as Prisma.InputJsonValue,
        aiGenerated: true,
        metered: synthesis.metered,
      },
    });

    await prisma.eventRecapSection.create({
      data: {
        recapId: recap.id,
        kind: "CERTIFICATES",
        status: RecapSectionStatus.DRAFT,
        title: certs.title,
        bodyMarkdown: certs.bodyMarkdown,
        structured: certs.structured as unknown as Prisma.InputJsonValue,
        aiGenerated: true,
        metered: false,
      },
    });

    for (const page of sponsorPages) {
      await prisma.eventRecapSection.create({
        data: {
          recapId: recap.id,
          kind: "SPONSOR_ONE_PAGER",
          status: RecapSectionStatus.DRAFT,
          sponsorId: page.sponsorId,
          title: page.title,
          bodyMarkdown: page.bodyMarkdown,
          structured: page.structured as unknown as Prisma.InputJsonValue,
          aiGenerated: true,
          metered: false,
        },
      });
    }

    // Insert fresh DRAFT emails only for kinds that are not already SENT.
    const sentKinds = new Set(
      (
        await prisma.eventRecapEmail.findMany({
          where: { recapId: recap.id, status: RecapEmailStatus.SENT },
          select: { kind: true },
        })
      ).map((e) => e.kind),
    );

    for (const email of emails) {
      if (sentKinds.has(email.kind)) continue;
      await prisma.eventRecapEmail.create({
        data: {
          recapId: recap.id,
          kind: email.kind,
          status: RecapEmailStatus.DRAFT,
          audienceRole: email.audienceRole,
          subject: email.subject,
          body: email.body,
          aiGenerated: true,
        },
      });
    }

    const now = new Date();
    await prisma.eventRecap.update({
      where: { id: recap.id },
      data: {
        status: RecapStatus.READY,
        metricsSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        feedbackQuoteBank: quoteBank as unknown as Prisma.InputJsonValue,
        fixNextYear: synthesis.fixNextYear as unknown as Prisma.InputJsonValue,
        generatedAt: isRegeneration ? priorGeneratedAt ?? now : now,
        regeneratedAt: isRegeneration ? now : null,
        lastJobId: input.jobId ?? null,
      },
    });

    if (event.seriesId && synthesis.fixNextYear.length) {
      await applyFixNextYearToSeries({
        seriesId: event.seriesId,
        eventId: event.id,
        recapId: recap.id,
        fixNextYear: synthesis.fixNextYear,
      });
    }

    return {
      recapId: recap.id,
      status: RecapStatus.READY,
      regenerated: isRegeneration,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Recap generation failed";
    const code = err instanceof RecapSectionError ? err.code : "GENERATE_FAILED";
    await prisma.eventRecap.update({
      where: { id: recap.id },
      data: {
        status: RecapStatus.FAILED,
        lastJobId: input.jobId ?? null,
      },
    });
    const wrapped = new RecapSectionError(code, message);
    throw wrapped;
  }
}
