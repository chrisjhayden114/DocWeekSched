/**
 * Background job: certificates.batch_issue
 */

import { z } from "zod";
import { prisma } from "../db";
import { enqueueJob, registerJobHandler } from "../jobs";
import { listEligibleUserIds } from "./eligibility";
import {
  issueCertificateForUser,
  markCertificateReadyEmailSent,
  wasCertificateReadyEmailSent,
} from "./issue";
import { sendCertificateReadyEmail } from "../mail";

export const CERTIFICATES_BATCH_ISSUE_JOB = "certificates.batch_issue";

const payloadSchema = z.object({
  certificateTemplateId: z.string().min(1),
  sendReadyEmail: z.boolean().optional().default(false),
});

export async function enqueueCertificateBatchIssue(input: {
  certificateTemplateId: string;
  organizationId: string;
  eventId: string;
  createdById: string;
  sendReadyEmail?: boolean;
}): Promise<{ id: string }> {
  return enqueueJob({
    type: CERTIFICATES_BATCH_ISSUE_JOB,
    organizationId: input.organizationId,
    eventId: input.eventId,
    createdById: input.createdById,
    payload: {
      certificateTemplateId: input.certificateTemplateId,
      sendReadyEmail: Boolean(input.sendReadyEmail),
    },
  });
}

export function registerCertificateJobs(): void {
  registerJobHandler(CERTIFICATES_BATCH_ISSUE_JOB, async (job) => {
    const parsed = payloadSchema.safeParse(job.input);
    if (!parsed.success) throw new Error("Invalid certificates.batch_issue payload");

    const template = await prisma.certificateTemplate.findFirst({
      where: {
        id: parsed.data.certificateTemplateId,
        ...(job.eventId ? { eventId: job.eventId } : {}),
        ...(job.organizationId ? { organizationId: job.organizationId } : {}),
      },
      include: {
        event: {
          select: {
            id: true,
            name: true,
            startDate: true,
            endDate: true,
            timezone: true,
            organizationId: true,
          },
        },
      },
    });
    if (!template) throw new Error("Certificate template not found");

    const eligibleIds = await listEligibleUserIds(template);
    const total = eligibleIds.length;
    let issued = 0;
    let regenerated = 0;
    let emailsSent = 0;

    await job.updateProgress(0, `Issuing 0 of ${total}`);

    for (let i = 0; i < eligibleIds.length; i++) {
      const userId = eligibleIds[i]!;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true },
      });
      if (!user) continue;

      const result = await issueCertificateForUser({
        template,
        user,
        issuedByUserId: job.createdById,
        batchJobId: job.id,
        skipEligibilityCheck: true,
      });
      if (!result) continue;

      if (result.created) issued += 1;
      if (result.regenerated) regenerated += 1;

      if (parsed.data.sendReadyEmail && result.created) {
        const already = await wasCertificateReadyEmailSent(result.id);
        if (!already) {
          // Soft rate limit: small delay between ready emails in large batches
          if (emailsSent > 0 && emailsSent % 20 === 0) {
            await new Promise((r) => setTimeout(r, 250));
          }
          await sendCertificateReadyEmail({
            to: user.email,
            name: user.name,
            eventName: template.event.name,
            certificateId: result.publicId,
          });
          await markCertificateReadyEmailSent({
            issuedCertificateId: result.id,
            organizationId: template.organizationId,
            eventId: template.eventId,
          });
          emailsSent += 1;
        }
      }

      const done = i + 1;
      await job.updateProgress(
        Math.round((done / Math.max(total, 1)) * 100),
        `Issued ${done} of ${total}`,
      );
    }

    return {
      issued,
      regenerated,
      skippedIneligible: 0,
      totalEligible: total,
      emailsSent,
    };
  });
}
