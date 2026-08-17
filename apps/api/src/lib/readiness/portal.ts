import { Prisma } from "@prisma/client";
import { writeAuditLog } from "../ai";
import { HttpError } from "../authorization";
import { prisma } from "../db";
import { env } from "../env";
import { featureEnabled } from "../features";
import { sendReadinessInviteEmail } from "../mail";
import { getStorageProvider } from "../storage";
import { deriveAssignmentState } from "./status";
import {
  assertFileAllowed,
  contentDisposition,
  fileRulesForRequirement,
  readStoredFile,
} from "./files";
import {
  evaluatePortalAccess,
  hashPortalToken,
  newPortalToken,
  portalDenialMessage,
  type PortalTokenDenial,
} from "./portalTokens";

const ORGANIZER_ONLY_KINDS = new Set(["internal_checklist"]);

const portalNotFound = (reason: PortalTokenDenial) =>
  new HttpError(404, { error: portalDenialMessage(reason), reason });

function portalUrl(raw: string): string {
  return `${env.webBaseUrl.replace(/\/$/, "")}/r/${raw}`;
}

function formatEventDates(event: { startDate: Date; endDate: Date; timezone: string }): string {
  try {
    const { startDate, endDate, timezone } = event;
    const day = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
    });
    const year = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric" });
    const startYear = year.format(startDate);
    const endYear = year.format(endDate);
    if (day.format(startDate) === day.format(endDate) && startYear === endYear) {
      return `${day.format(startDate)}, ${endYear}`;
    }
    if (startYear === endYear) {
      return `${day.format(startDate)} – ${day.format(endDate)}, ${endYear}`;
    }
    return `${day.format(startDate)}, ${startYear} – ${day.format(endDate)}, ${endYear}`;
  } catch {
    return `${event.startDate.toISOString().slice(0, 10)} – ${event.endDate.toISOString().slice(0, 10)}`;
  }
}

function shapeAccess(row: {
  id: string;
  speakerId: string;
  email: string;
  createdAt: Date;
  lastSentAt: Date | null;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
}) {
  return {
    id: row.id,
    speakerId: row.speakerId,
    email: row.email,
    invitedAt: row.lastSentAt ?? row.createdAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    lastUsedAt: row.lastUsedAt,
  };
}

export async function listPortalAccess(eventId: string) {
  const rows = await prisma.readinessPortalAccess.findMany({
    where: { eventId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(shapeAccess);
}

async function assertSpeakerAssignable(eventId: string, speakerId: string) {
  const speaker = await prisma.speaker.findFirst({
    where: { id: speakerId, eventId },
    select: { id: true, name: true },
  });
  if (!speaker) {
    throw new HttpError(400, { error: "Speaker does not belong to this event" });
  }
  const assignmentCount = await prisma.readinessAssignment.count({
    where: { eventId, speakerId },
  });
  if (assignmentCount < 1) {
    throw new HttpError(400, { error: "Speaker has no readiness assignments yet" });
  }
  return speaker;
}

async function requirementLabelsForSpeaker(eventId: string, speakerId: string) {
  const assignments = await prisma.readinessAssignment.findMany({
    where: { eventId, speakerId },
    include: { requirement: { select: { label: true, kind: true, dueAt: true } } },
  });
  const labels: string[] = [];
  let nearestDue: Date | null = null;
  for (const a of assignments) {
    if (ORGANIZER_ONLY_KINDS.has(a.requirement.kind)) continue;
    labels.push(a.requirement.label);
    const due = a.dueAtOverride ?? a.requirement.dueAt;
    if (due && (!nearestDue || due.getTime() < nearestDue.getTime())) nearestDue = due;
  }
  return { labels, nearestDueAt: nearestDue };
}

async function sendInvite(opts: {
  email: string;
  speakerName: string;
  eventName: string;
  raw: string;
  eventId: string;
  speakerId: string;
}) {
  const { labels, nearestDueAt } = await requirementLabelsForSpeaker(opts.eventId, opts.speakerId);
  return sendReadinessInviteEmail({
    to: opts.email,
    speakerName: opts.speakerName,
    eventName: opts.eventName,
    portalUrl: portalUrl(opts.raw),
    requirementLabels: labels,
    nearestDueAt,
  });
}

export async function mintPortalAccess(
  eventId: string,
  organizationId: string,
  input: { speakerId: string; email: string },
  actorUserId: string,
  now = new Date(),
) {
  const speaker = await assertSpeakerAssignable(eventId, input.speakerId);
  const event = await prisma.event.findUniqueOrThrow({
    where: { id: eventId },
    select: { name: true },
  });
  const token = newPortalToken(now);
  const email = input.email.trim().toLowerCase();

  const row = await prisma.readinessPortalAccess.upsert({
    where: { eventId_speakerId: { eventId, speakerId: speaker.id } },
    create: {
      organizationId,
      eventId,
      speakerId: speaker.id,
      email,
      tokenHash: token.hash,
      expiresAt: token.expiresAt,
      revokedAt: null,
      lastSentAt: now,
      lastUsedAt: null,
    },
    update: {
      email,
      tokenHash: token.hash,
      expiresAt: token.expiresAt,
      revokedAt: null,
      lastSentAt: now,
    },
  });

  await writeAuditLog({
    organizationId,
    eventId,
    actorUserId,
    action: "OTHER",
    entityType: "ReadinessPortalAccess",
    entityId: row.id,
    payload: { action: "invite", speakerId: speaker.id },
  });

  const mail = await sendInvite({
    email,
    speakerName: speaker.name,
    eventName: event.name,
    raw: token.raw,
    eventId,
    speakerId: speaker.id,
  });

  return {
    url: portalUrl(token.raw),
    access: shapeAccess(row),
    email: {
      delivered: mail.delivered,
      copyUrl: mail.copyUrl ?? portalUrl(token.raw),
      fallbackMessage: mail.fallbackMessage,
    },
  };
}

async function loadAccessForEvent(eventId: string, accessId: string) {
  const row = await prisma.readinessPortalAccess.findFirst({
    where: { id: accessId, eventId },
    include: { speaker: { select: { name: true } }, event: { select: { name: true } } },
  });
  if (!row) throw new HttpError(404, { error: "Portal access not found" });
  return row;
}

export async function remintPortalAccess(
  eventId: string,
  accessId: string,
  actorUserId: string,
  now = new Date(),
) {
  const existing = await loadAccessForEvent(eventId, accessId);
  const token = newPortalToken(now);
  const row = await prisma.readinessPortalAccess.update({
    where: { id: existing.id },
    data: {
      tokenHash: token.hash,
      expiresAt: token.expiresAt,
      revokedAt: null,
      lastSentAt: now,
    },
  });

  await writeAuditLog({
    organizationId: existing.organizationId,
    eventId,
    actorUserId,
    action: "OTHER",
    entityType: "ReadinessPortalAccess",
    entityId: row.id,
    payload: { action: "remint", speakerId: existing.speakerId },
  });

  const mail = await sendInvite({
    email: existing.email,
    speakerName: existing.speaker.name,
    eventName: existing.event.name,
    raw: token.raw,
    eventId,
    speakerId: existing.speakerId,
  });

  return {
    url: portalUrl(token.raw),
    access: shapeAccess(row),
    email: {
      delivered: mail.delivered,
      copyUrl: mail.copyUrl ?? portalUrl(token.raw),
      fallbackMessage: mail.fallbackMessage,
    },
  };
}

export async function revokePortalAccess(eventId: string, accessId: string, actorUserId: string, now = new Date()) {
  const existing = await loadAccessForEvent(eventId, accessId);
  const row = await prisma.readinessPortalAccess.update({
    where: { id: existing.id },
    data: { revokedAt: now },
  });
  await writeAuditLog({
    organizationId: existing.organizationId,
    eventId,
    actorUserId,
    action: "OTHER",
    entityType: "ReadinessPortalAccess",
    entityId: row.id,
    payload: { action: "revoke", speakerId: existing.speakerId },
  });
  return shapeAccess(row);
}

/** O1 — archive stamps revokedAt on every live portal token for the event. */
export async function revokePortalAccessForEvent(eventId: string, now = new Date()) {
  await prisma.readinessPortalAccess.updateMany({
    where: { eventId, revokedAt: null },
    data: { revokedAt: now },
  });
}

export async function resolvePortalAccess(rawToken: string, now = new Date()) {
  const hash = hashPortalToken(rawToken);
  const row = await prisma.readinessPortalAccess.findUnique({
    where: { tokenHash: hash },
    include: {
      speaker: { select: { id: true, name: true } },
      event: {
        select: {
          id: true,
          name: true,
          startDate: true,
          endDate: true,
          timezone: true,
          logoUrl: true,
          brandColor: true,
        },
      },
    },
  });
  const verdict = evaluatePortalAccess(row, now);
  if (!verdict.ok || !row) throw portalNotFound(verdict.ok ? "unknown" : verdict.reason);
  // Feature-off looks like an unknown token — don't confirm the link exists.
  if (!(await featureEnabled(row.eventId, "readiness"))) throw portalNotFound("unknown");
  return row;
}

function submissionValue(sub: {
  valueText: string | null;
  valueJson: Prisma.JsonValue;
}): unknown {
  if (sub.valueJson !== null && sub.valueJson !== undefined) return sub.valueJson;
  return sub.valueText;
}

function shapeLatestSubmission(sub: {
  id: string;
  valueText: string | null;
  valueJson: Prisma.JsonValue;
  fileName: string | null;
  createdAt: Date;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  reviewNote: string | null;
} | null) {
  if (!sub) return null;
  return {
    id: sub.id,
    value: submissionValue(sub),
    fileName: sub.fileName,
    submittedAt: sub.createdAt,
    approvedAt: sub.approvedAt,
    rejectedAt: sub.rejectedAt,
    rejectedReason: sub.reviewNote,
  };
}

export async function getPortalView(rawToken: string, now = new Date()) {
  const access = await resolvePortalAccess(rawToken, now);
  await prisma.readinessPortalAccess.update({
    where: { id: access.id },
    data: { lastUsedAt: now },
  });

  const assignments = await prisma.readinessAssignment.findMany({
    where: { eventId: access.eventId, speakerId: access.speakerId },
    include: {
      requirement: {
        select: {
          label: true,
          helpText: true,
          kind: true,
          config: true,
          required: true,
          dueAt: true,
        },
      },
      submissions: {
        where: { supersededAt: null },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  return {
    event: {
      name: access.event.name,
      dates: formatEventDates(access.event),
      logoUrl: access.event.logoUrl,
      brandColor: access.event.brandColor,
    },
    speakerName: access.speaker.name,
    assignments: assignments
      .filter((a) => !ORGANIZER_ONLY_KINDS.has(a.requirement.kind))
      .map((a) => {
        const derived = deriveAssignmentState(a, now);
        const config = (a.requirement.config ?? {}) as Record<string, unknown>;
        return {
          id: a.id,
          requirement: {
            label: a.requirement.label,
            helpText: a.requirement.helpText,
            kind: a.requirement.kind,
            config,
            required: a.requirement.required,
          },
          dueAt: derived.effectiveDueAt,
          status: a.status,
          latestSubmission: shapeLatestSubmission(a.submissions[0] ?? null),
        };
      }),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function optionsFromConfig(config: Record<string, unknown>): string[] {
  return Array.isArray(config.options)
    ? config.options.filter((o): o is string => typeof o === "string")
    : [];
}

function validateSubmissionValue(
  kind: string,
  value: unknown,
  config: Record<string, unknown>,
): { valueText: string | null; valueJson: Prisma.InputJsonValue | typeof Prisma.JsonNull } {
  const maxShort = typeof config.maxLength === "number" ? config.maxLength : 500;
  const maxLong = typeof config.maxLength === "number" ? config.maxLength : 8000;

  if (kind === "short_text" || kind === "long_text") {
    if (typeof value !== "string" || !value.trim()) {
      throw new HttpError(400, { error: "Enter a value for this requirement." });
    }
    const max = kind === "short_text" ? maxShort : maxLong;
    if (value.length > max) {
      throw new HttpError(400, { error: `Keep this under ${max} characters.` });
    }
    return { valueText: value.trim(), valueJson: value.trim() };
  }

  if (kind === "confirm" || kind === "agreement") {
    const yes = value === true || value === "yes" || value === "true";
    const no = value === false || value === "no" || value === "false";
    if (!yes && !no) {
      throw new HttpError(400, { error: "Choose yes or no." });
    }
    return { valueText: yes ? "yes" : "no", valueJson: yes };
  }

  if (kind === "select") {
    const options = optionsFromConfig(config);
    if (typeof value !== "string" || (options.length > 0 && !options.includes(value))) {
      throw new HttpError(400, { error: "Choose one of the listed options." });
    }
    return { valueText: value, valueJson: value };
  }

  if (kind === "multi_select") {
    if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
      throw new HttpError(400, { error: "Choose one or more of the listed options." });
    }
    const options = optionsFromConfig(config);
    const picked = value as string[];
    if (options.length > 0 && picked.some((v) => !options.includes(v))) {
      throw new HttpError(400, { error: "Choose only from the listed options." });
    }
    if (picked.length === 0) {
      throw new HttpError(400, { error: "Choose at least one option." });
    }
    return { valueText: picked.join(", "), valueJson: picked };
  }

  if (kind === "date") {
    if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
      throw new HttpError(400, { error: "Enter a valid date." });
    }
    return { valueText: value, valueJson: value };
  }

  if (kind === "url") {
    if (typeof value !== "string") {
      throw new HttpError(400, { error: "Enter a URL." });
    }
    let parsed: URL;
    try {
      parsed = new URL(value.trim());
    } catch {
      throw new HttpError(400, { error: "Enter a valid URL (starting with https://)." });
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new HttpError(400, { error: "Enter a valid URL (starting with https://)." });
    }
    return { valueText: parsed.toString(), valueJson: parsed.toString() };
  }

  if (kind === "file") {
    return { valueText: null, valueJson: Prisma.JsonNull };
  }

  throw new HttpError(400, { error: "This requirement cannot be submitted here." });
}

export async function submitPortalAssignment(
  rawToken: string,
  assignmentId: string,
  body: { value?: unknown; fileUrl?: string; fileName?: string; mime?: string },
  now = new Date(),
) {
  const access = await resolvePortalAccess(rawToken, now);

  const assignment = await prisma.readinessAssignment.findFirst({
    where: { id: assignmentId, eventId: access.eventId, speakerId: access.speakerId },
    include: { requirement: true },
  });
  if (!assignment) {
    throw new HttpError(404, { error: "Assignment not found", reason: "not_found" });
  }
  if (ORGANIZER_ONLY_KINDS.has(assignment.requirement.kind)) {
    throw new HttpError(404, { error: "Assignment not found", reason: "not_found" });
  }

  const config = asRecord(assignment.requirement.config);
  const kind = assignment.requirement.kind;

  let fileUrl: string | null = null;
  let fileStorageKey: string | null = null;
  let fileName: string | null = null;
  let fileMime: string | null = null;
  let fileSizeBytes: number | null = null;
  let valueText: string | null = null;
  let valueJson: Prisma.InputJsonValue | typeof Prisma.JsonNull = Prisma.JsonNull;

  if (kind === "file") {
    if (!body.fileUrl?.trim()) {
      throw new HttpError(400, { error: "Attach a file to submit this requirement." });
    }
    const checked = assertFileAllowed({
      fileUrl: body.fileUrl,
      mime: body.mime,
      config,
    });
    const rules = fileRulesForRequirement(config);
    try {
      const stored = await getStorageProvider().acceptUpload({
        url: body.fileUrl.trim(),
        keyPrefix: `events/${access.eventId}/readiness/${assignment.id}`,
        maxBytes: rules.maxBytes,
        allowedMimeTypes: rules.allowedMimeTypes,
      });
      fileUrl = stored.url;
      fileStorageKey = stored.storageKey;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not store the file.";
      if (/exceeds max size/i.test(message)) {
        throw new HttpError(400, {
          error: `This file is too large. Maximum size is ${Math.round(rules.maxBytes / 1_000_000)} MB.`,
          reason: "too_large",
        });
      }
      if (/MIME type not allowed/i.test(message)) {
        throw new HttpError(400, {
          error: "This file type isn't accepted. Use PDF, DOCX, or an image (PNG or JPEG).",
          reason: "wrong_type",
        });
      }
      throw new HttpError(400, { error: message, reason: "invalid_file" });
    }
    fileName = body.fileName?.trim() || "upload";
    fileMime = checked.mime;
    fileSizeBytes = checked.sizeBytes;
  } else {
    const validated = validateSubmissionValue(kind, body.value, config);
    valueText = validated.valueText;
    valueJson = validated.valueJson;
  }

  const created = await prisma.$transaction(async (tx) => {
    await tx.readinessSubmission.updateMany({
      where: { assignmentId: assignment.id, supersededAt: null },
      data: { supersededAt: now },
    });
    const submission = await tx.readinessSubmission.create({
      data: {
        assignmentId: assignment.id,
        eventId: access.eventId,
        valueText,
        valueJson,
        fileName,
        fileMime,
        fileSizeBytes,
        fileUrl,
        fileStorageKey,
        submittedVia: "portal",
        aiGenerated: false,
      },
    });
    await tx.readinessAssignment.update({
      where: { id: assignment.id },
      data: { status: "SUBMITTED" },
    });
    return submission;
  });

  await prisma.readinessPortalAccess.update({
    where: { id: access.id },
    data: { lastUsedAt: now },
  });

  return {
    id: created.id,
    status: "SUBMITTED" as const,
    latestSubmission: shapeLatestSubmission(created),
  };
}

export async function streamPortalFile(rawToken: string, submissionId: string, now = new Date()) {
  const access = await resolvePortalAccess(rawToken, now);
  const submission = await prisma.readinessSubmission.findFirst({
    where: { id: submissionId, eventId: access.eventId },
    include: { assignment: { select: { speakerId: true } } },
  });
  if (!submission || submission.assignment.speakerId !== access.speakerId || !submission.fileUrl) {
    throw new HttpError(404, { error: "File not found", reason: "not_found" });
  }
  const stored = await readStoredFile(submission);
  if (!stored) throw new HttpError(404, { error: "File not found", reason: "not_found" });
  return {
    body: stored.body,
    contentType: stored.contentType,
    contentDisposition: contentDisposition(submission.fileName),
  };
}

export async function reviewSubmission(
  eventId: string,
  submissionId: string,
  input: { action: "approve" | "reject"; reason?: string | null },
  actorUserId: string,
  now = new Date(),
) {
  const submission = await prisma.readinessSubmission.findFirst({
    where: { id: submissionId, eventId },
    include: { assignment: true },
  });
  if (!submission) throw new HttpError(404, { error: "Submission not found" });
  if (submission.supersededAt) {
    throw new HttpError(400, { error: "This submission has been replaced by a newer one." });
  }

  if (input.action === "reject") {
    const reason = input.reason?.trim();
    if (!reason) {
      throw new HttpError(400, { error: "A reason is required when rejecting." });
    }
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.readinessSubmission.update({
        where: { id: submission.id },
        data: {
          rejectedAt: now,
          rejectedById: actorUserId,
          reviewNote: reason,
          approvedAt: null,
          approvedById: null,
        },
      });
      await tx.readinessAssignment.update({
        where: { id: submission.assignmentId },
        data: { status: "IN_PROGRESS" },
      });
      return row;
    });
    await writeAuditLog({
      organizationId: submission.assignment.organizationId,
      eventId,
      actorUserId,
      action: "OTHER",
      entityType: "ReadinessAssignment",
      entityId: submission.assignmentId,
      payload: { action: "reject", submissionId: submission.id, reason },
    });
    return updated;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.readinessSubmission.update({
      where: { id: submission.id },
      data: {
        approvedAt: now,
        approvedById: actorUserId,
        rejectedAt: null,
        rejectedById: null,
        reviewNote: null,
      },
    });
    await tx.readinessAssignment.update({
      where: { id: submission.assignmentId },
      data: { status: "READY" },
    });
    return row;
  });
  await writeAuditLog({
    organizationId: submission.assignment.organizationId,
    eventId,
    actorUserId,
    action: "OTHER",
    entityType: "ReadinessAssignment",
    entityId: submission.assignmentId,
    payload: { action: "approve", submissionId: submission.id },
  });
  return updated;
}

export async function streamOrganizerFile(eventId: string, submissionId: string) {
  const submission = await prisma.readinessSubmission.findFirst({
    where: { id: submissionId, eventId },
  });
  if (!submission || (!submission.fileUrl && !submission.fileStorageKey)) {
    throw new HttpError(404, { error: "File not found" });
  }
  const stored = await readStoredFile(submission);
  if (!stored) throw new HttpError(404, { error: "File not found" });
  return {
    body: stored.body,
    contentType: stored.contentType,
    contentDisposition: contentDisposition(submission.fileName),
  };
}
