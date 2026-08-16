import { Prisma } from "@prisma/client";
import { writeAuditLog } from "../ai";
import { HttpError } from "../authorization";
import { prisma } from "../db";
import {
  deriveAssignmentState,
  rollupSubject,
  type AssignmentForDerivation,
  type StoredReadinessStatus,
  type SubjectRollup,
} from "./status";

/**
 * ER2 — organizer-facing readiness operations. Every function takes the
 * ALREADY-AUTHORIZED event id (routes resolve it via resolveEventFromRequest +
 * requireEventAccess(manage) + requireFeature) and re-scopes every row lookup
 * by that eventId, so a real id from another event 404s instead of leaking.
 */

export const READINESS_REQUIREMENT_KINDS = [
  "short_text",
  "long_text",
  "confirm",
  "select",
  "multi_select",
  "date",
  "url",
  "file",
  "agreement",
  "internal_checklist",
] as const;
export type ReadinessRequirementKind = (typeof READINESS_REQUIREMENT_KINDS)[number];

const templateNotFound = () => new HttpError(404, { error: "Template not found" });
const requirementNotFound = () => new HttpError(404, { error: "Requirement not found" });
const assignmentNotFound = () => new HttpError(404, { error: "Assignment not found" });

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export type ReadinessSubjectRef =
  | { type: "speaker"; id: string; name: string }
  | { type: "session"; id: string; name: string };

export async function getReadinessOverview(eventId: string, now: Date = new Date()) {
  const [templates, assignments] = await Promise.all([
    prisma.readinessTemplate.findMany({
      where: { eventId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: {
        requirements: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }] },
      },
    }),
    prisma.readinessAssignment.findMany({
      where: { eventId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: {
        requirement: { select: { id: true, templateId: true, label: true, dueAt: true } },
        speaker: { select: { id: true, name: true } },
        session: { select: { id: true, title: true } },
        sessionItem: { select: { id: true, title: true } },
      },
    }),
  ]);

  const subjectAssignments = new Map<
    string,
    { subject: ReadinessSubjectRef; rows: AssignmentForDerivation[] }
  >();

  const shaped = assignments.map((a) => {
    const subject: ReadinessSubjectRef = a.speaker
      ? { type: "speaker", id: a.speaker.id, name: a.speaker.name }
      : { type: "session", id: a.sessionId!, name: a.session?.title ?? "" };
    const key = `${subject.type}:${subject.id}`;
    const group = subjectAssignments.get(key) ?? { subject, rows: [] };
    group.rows.push(a);
    subjectAssignments.set(key, group);

    const derived = deriveAssignmentState(a, now);
    return {
      id: a.id,
      templateId: a.requirement.templateId,
      requirementId: a.requirementId,
      requirementLabel: a.requirement.label,
      speakerId: a.speakerId,
      sessionId: a.sessionId,
      sessionItemId: a.sessionItemId,
      sessionItemTitle: a.sessionItem?.title ?? null,
      subject,
      status: a.status,
      late: derived.late,
      effectiveDueAt: derived.effectiveDueAt,
      dueAtOverride: a.dueAtOverride,
      waivedAt: a.waivedAt,
      waivedById: a.waivedById,
      ownerUserId: a.ownerUserId,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    };
  });

  const subjects: Array<ReadinessSubjectRef & { rollup: SubjectRollup }> = [
    ...subjectAssignments.values(),
  ]
    .map(({ subject, rows }) => ({ ...subject, rollup: rollupSubject(rows, now) }))
    .sort((x, y) =>
      x.type !== y.type ? x.type.localeCompare(y.type) : x.name.localeCompare(y.name) || x.id.localeCompare(y.id),
    );

  return { templates, assignments: shaped, subjects };
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export async function createTemplate(
  eventId: string,
  organizationId: string,
  input: { name: string; description?: string | null },
) {
  try {
    return await prisma.readinessTemplate.create({
      data: {
        eventId,
        organizationId,
        name: input.name.trim(),
        description: input.description?.trim() || null,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new HttpError(400, { error: "A template with that name already exists" });
    }
    throw err;
  }
}

export async function updateTemplate(
  eventId: string,
  templateId: string,
  patch: { name?: string; description?: string | null },
) {
  const existing = await prisma.readinessTemplate.findFirst({
    where: { id: templateId, eventId },
  });
  if (!existing) throw templateNotFound();
  try {
    return await prisma.readinessTemplate.update({
      where: { id: existing.id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.description !== undefined
          ? { description: patch.description?.trim() || null }
          : {}),
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new HttpError(400, { error: "A template with that name already exists" });
    }
    throw err;
  }
}

/** Cascade removes the template's requirements and their assignments. */
export async function deleteTemplate(eventId: string, templateId: string) {
  const existing = await prisma.readinessTemplate.findFirst({
    where: { id: templateId, eventId },
  });
  if (!existing) throw templateNotFound();
  await prisma.readinessTemplate.delete({ where: { id: existing.id } });
}

// ---------------------------------------------------------------------------
// Requirements
// ---------------------------------------------------------------------------

export type RequirementInput = {
  label: string;
  kind: ReadinessRequirementKind;
  helpText?: string | null;
  config?: Record<string, unknown>;
  required?: boolean;
  dueAt?: Date | null;
  sortOrder?: number;
};

export async function createRequirement(
  eventId: string,
  templateId: string,
  input: RequirementInput,
) {
  const template = await prisma.readinessTemplate.findFirst({
    where: { id: templateId, eventId },
  });
  if (!template) throw templateNotFound();
  return prisma.readinessRequirement.create({
    data: {
      templateId: template.id,
      eventId,
      label: input.label.trim(),
      kind: input.kind,
      helpText: input.helpText?.trim() || null,
      config: (input.config ?? {}) as Prisma.InputJsonValue,
      required: input.required ?? true,
      dueAt: input.dueAt ?? null,
      sortOrder: input.sortOrder ?? 0,
    },
  });
}

export async function updateRequirement(
  eventId: string,
  requirementId: string,
  patch: Partial<RequirementInput>,
) {
  const existing = await prisma.readinessRequirement.findFirst({
    where: { id: requirementId, eventId },
  });
  if (!existing) throw requirementNotFound();
  return prisma.readinessRequirement.update({
    where: { id: existing.id },
    data: {
      ...(patch.label !== undefined ? { label: patch.label.trim() } : {}),
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
      ...(patch.helpText !== undefined ? { helpText: patch.helpText?.trim() || null } : {}),
      ...(patch.config !== undefined ? { config: patch.config as Prisma.InputJsonValue } : {}),
      ...(patch.required !== undefined ? { required: patch.required } : {}),
      ...(patch.dueAt !== undefined ? { dueAt: patch.dueAt } : {}),
      ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
    },
  });
}

export async function deleteRequirement(eventId: string, requirementId: string) {
  const existing = await prisma.readinessRequirement.findFirst({
    where: { id: requirementId, eventId },
  });
  if (!existing) throw requirementNotFound();
  await prisma.readinessRequirement.delete({ where: { id: existing.id } });
}

// ---------------------------------------------------------------------------
// Assignment creation (template × subjects)
// ---------------------------------------------------------------------------

/**
 * Create one assignment per (requirement × subject), skipping pairs that
 * already exist (idempotent re-run — audit §10.2). Subjects must belong to
 * the SAME event; a real id from another event is a 400, not a silent skip.
 */
export async function assignTemplate(
  eventId: string,
  organizationId: string,
  templateId: string,
  input: { speakerIds?: string[]; sessionIds?: string[] },
): Promise<{ created: number; skipped: number }> {
  const speakerIds = [...new Set(input.speakerIds ?? [])];
  const sessionIds = [...new Set(input.sessionIds ?? [])];
  if (speakerIds.length === 0 && sessionIds.length === 0) {
    throw new HttpError(400, { error: "Provide at least one speaker or session" });
  }

  const template = await prisma.readinessTemplate.findFirst({
    where: { id: templateId, eventId },
    include: { requirements: { select: { id: true } } },
  });
  if (!template) throw templateNotFound();

  // Tenant isolation: every subject must live in this event.
  if (speakerIds.length > 0) {
    const count = await prisma.speaker.count({ where: { id: { in: speakerIds }, eventId } });
    if (count !== speakerIds.length) {
      throw new HttpError(400, { error: "One or more speakers do not belong to this event" });
    }
  }
  if (sessionIds.length > 0) {
    const count = await prisma.session.count({ where: { id: { in: sessionIds }, eventId } });
    if (count !== sessionIds.length) {
      throw new HttpError(400, { error: "One or more sessions do not belong to this event" });
    }
  }

  const requirementIds = template.requirements.map((r) => r.id);
  if (requirementIds.length === 0) return { created: 0, skipped: 0 };

  // The DB unique key can't dedupe rows whose optional subject columns are
  // NULL (Postgres NULLs are distinct), so dedupe here against existing rows.
  const existing = await prisma.readinessAssignment.findMany({
    where: {
      requirementId: { in: requirementIds },
      OR: [
        ...(speakerIds.length > 0 ? [{ speakerId: { in: speakerIds } }] : []),
        ...(sessionIds.length > 0 ? [{ sessionId: { in: sessionIds } }] : []),
      ],
    },
    select: { requirementId: true, speakerId: true, sessionId: true },
  });
  const seen = new Set(
    existing.map((a) => `${a.requirementId}|${a.speakerId ?? ""}|${a.sessionId ?? ""}`),
  );

  const rows: Prisma.ReadinessAssignmentCreateManyInput[] = [];
  let skipped = 0;
  for (const requirementId of requirementIds) {
    for (const speakerId of speakerIds) {
      if (seen.has(`${requirementId}|${speakerId}|`)) skipped += 1;
      else rows.push({ organizationId, eventId, requirementId, speakerId });
    }
    for (const sessionId of sessionIds) {
      if (seen.has(`${requirementId}||${sessionId}`)) skipped += 1;
      else rows.push({ organizationId, eventId, requirementId, sessionId });
    }
  }

  if (rows.length > 0) await prisma.readinessAssignment.createMany({ data: rows });
  return { created: rows.length, skipped };
}

// ---------------------------------------------------------------------------
// Assignment update (status / due-date override / owner)
// ---------------------------------------------------------------------------

export type AssignmentPatch = {
  status?: StoredReadinessStatus;
  /** undefined = leave, null = clear, Date = set. */
  dueAtOverride?: Date | null;
  /** undefined = leave, null = clear. */
  ownerUserId?: string | null;
};

/**
 * WAIVED stamps waivedAt/waivedById from the acting user and writes an
 * AuditLog row (action OTHER, entityType "ReadinessAssignment" — the audit
 * doc's activity decision); moving off WAIVED clears them, also audited.
 */
export async function updateAssignment(
  eventId: string,
  assignmentId: string,
  patch: AssignmentPatch,
  actorUserId: string,
  now: Date = new Date(),
) {
  const existing = await prisma.readinessAssignment.findFirst({
    where: { id: assignmentId, eventId },
  });
  if (!existing) throw assignmentNotFound();

  const data: Prisma.ReadinessAssignmentUpdateInput = {};
  if (patch.dueAtOverride !== undefined) data.dueAtOverride = patch.dueAtOverride;
  if (patch.ownerUserId !== undefined) data.ownerUserId = patch.ownerUserId;

  const waiving = patch.status === "WAIVED" && existing.status !== "WAIVED";
  const unwaiving =
    patch.status !== undefined && patch.status !== "WAIVED" && existing.status === "WAIVED";
  if (patch.status !== undefined) {
    data.status = patch.status;
    if (waiving) {
      data.waivedAt = now;
      data.waivedById = actorUserId;
    } else if (unwaiving) {
      data.waivedAt = null;
      data.waivedById = null;
    }
  }

  const updated = await prisma.readinessAssignment.update({
    where: { id: existing.id },
    data,
    include: { requirement: { select: { id: true, templateId: true, label: true, dueAt: true } } },
  });

  if (waiving || unwaiving) {
    await writeAuditLog({
      organizationId: existing.organizationId,
      eventId,
      actorUserId,
      action: "OTHER",
      entityType: "ReadinessAssignment",
      entityId: existing.id,
      payload: {
        action: waiving ? "waive" : "unwaive",
        fromStatus: existing.status,
        toStatus: patch.status!,
      },
    });
  }

  return updated;
}
