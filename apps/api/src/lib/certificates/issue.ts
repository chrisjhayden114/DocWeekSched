/**
 * Issue / regenerate certificates.
 * Upsert on (certificateTemplateId, userId): NEVER changes issuedAt or publicId;
 * sets regeneratedAt on re-issue.
 */

import { randomBytes } from "crypto";
import type { CertificateTemplate, Event, User } from "@prisma/client";
import { prisma } from "../db";
import { getStorageProvider } from "../storage";
import { writeAuditLog } from "../ai/audit";
import { formatCertificateDates, type CertificateMergeValues } from "./merge";
import { renderCertificatePdf } from "./pdf";
import { isUserEligible } from "./eligibility";

export const CERTIFICATE_READY_EMAIL_ENTITY = "certificate_ready_email";

export function generateCertificatePublicId(): string {
  return randomBytes(16).toString("base64url");
}

export type IssueCertificateResult = {
  id: string;
  publicId: string;
  issuedAt: Date;
  regeneratedAt: Date | null;
  created: boolean;
  regenerated: boolean;
  pdfStorageKey: string | null;
};

type TemplateWithEvent = CertificateTemplate & {
  event: Pick<Event, "id" | "name" | "startDate" | "endDate" | "timezone" | "organizationId">;
};

export async function issueCertificateForUser(input: {
  template: TemplateWithEvent;
  user: Pick<User, "id" | "name" | "email">;
  issuedByUserId?: string | null;
  batchJobId?: string | null;
  /** Skip eligibility check (caller already filtered). */
  skipEligibilityCheck?: boolean;
}): Promise<IssueCertificateResult | null> {
  const { template, user } = input;
  if (!input.skipEligibilityCheck) {
    const ok = await isUserEligible(template, user.id);
    if (!ok) return null;
  }

  const existing = await prisma.issuedCertificate.findUnique({
    where: {
      certificateTemplateId_userId: {
        certificateTemplateId: template.id,
        userId: user.id,
      },
    },
  });

  const attendeeNameSnapshot = user.name;
  const eventNameSnapshot = template.event.name;
  const eventDateSnapshot = template.event.startDate;
  const hoursSnapshot = template.hours ?? null;
  const now = new Date();

  const publicId = existing?.publicId ?? generateCertificatePublicId();
  const issuedAt = existing?.issuedAt ?? now;

  const merge: CertificateMergeValues = {
    attendeeName: attendeeNameSnapshot,
    eventName: eventNameSnapshot,
    dates: formatCertificateDates(
      template.event.startDate,
      template.event.endDate,
      template.event.timezone,
    ),
    hours: hoursSnapshot,
    signatureImage: template.signatureImageUrl,
    certificateId: publicId,
  };

  const pdf = await renderCertificatePdf({
    titleText: template.titleText,
    bodyText: template.bodyText,
    signatureImageUrl: template.signatureImageUrl,
    merge,
  });

  const stored = await getStorageProvider().put({
    key: `certificates/${template.eventId}/${publicId}.pdf`,
    body: pdf,
    contentType: "application/pdf",
  });
  const pdfStorageKey = stored.storageKey ?? stored.url;

  const row = await prisma.issuedCertificate.upsert({
    where: {
      certificateTemplateId_userId: {
        certificateTemplateId: template.id,
        userId: user.id,
      },
    },
    create: {
      publicId,
      organizationId: template.organizationId,
      eventId: template.eventId,
      certificateTemplateId: template.id,
      userId: user.id,
      attendeeNameSnapshot,
      eventNameSnapshot,
      eventDateSnapshot,
      hoursSnapshot,
      pdfStorageKey,
      issuedAt,
      regeneratedAt: null,
      issuedByUserId: input.issuedByUserId ?? null,
      batchJobId: input.batchJobId ?? null,
    },
    update: {
      attendeeNameSnapshot,
      eventNameSnapshot,
      eventDateSnapshot,
      hoursSnapshot,
      pdfStorageKey,
      regeneratedAt: now,
      issuedByUserId: input.issuedByUserId ?? undefined,
      batchJobId: input.batchJobId ?? undefined,
      // publicId and issuedAt intentionally omitted — never rewrite
    },
  });

  return {
    id: row.id,
    publicId: row.publicId,
    issuedAt: row.issuedAt,
    regeneratedAt: row.regeneratedAt,
    created: !existing,
    regenerated: Boolean(existing),
    pdfStorageKey: row.pdfStorageKey,
  };
}

/** Idempotent "certificate ready" email marker — do not re-send on regenerate. */
export async function wasCertificateReadyEmailSent(issuedCertificateId: string): Promise<boolean> {
  const row = await prisma.auditLog.findFirst({
    where: {
      entityType: CERTIFICATE_READY_EMAIL_ENTITY,
      entityId: issuedCertificateId,
    },
    select: { id: true },
  });
  return Boolean(row);
}

export async function markCertificateReadyEmailSent(input: {
  issuedCertificateId: string;
  organizationId: string;
  eventId: string;
}): Promise<void> {
  await writeAuditLog({
    organizationId: input.organizationId,
    eventId: input.eventId,
    action: "OTHER",
    entityType: CERTIFICATE_READY_EMAIL_ENTITY,
    entityId: input.issuedCertificateId,
    aiGenerated: false,
    payload: { kind: "certificate_ready" },
  });
}
