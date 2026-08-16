import { Router } from "express";
import { z } from "zod";
import { asyncHandler, requireEventAccess } from "../lib/authorization";
import { validationErrorBody } from "../lib/errors";
import { requireFeature } from "../lib/features";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";
import {
  assignTemplate,
  createRequirement,
  createTemplate,
  deleteRequirement,
  deleteTemplate,
  getReadinessOverview,
  READINESS_REQUIREMENT_KINDS,
  updateAssignment,
  updateRequirement,
  updateTemplate,
} from "../lib/readiness/service";
import { deriveAssignmentState } from "../lib/readiness/status";
import { resolveEventFromRequest } from "../lib/requestEvent";

/**
 * Event Readiness (ER2 — templates, requirements, assignments, derived
 * status). Organizer-manage surface only; the presenter portal is ER4.
 *
 * Every handler gates on the hidden `readiness` feature before anything
 * else, so the entire surface returns the standard feature-404 body unless
 * the org plan grants the entitlement (INTERNAL only until ER9) AND the
 * organizer turned the feature on. Every row lookup is re-scoped by the
 * resolved event id — a real id from another event 404s.
 */
export const readinessRouter = Router();

/** resolve event → feature gate → manage access, in that order (ER1 shape). */
async function requireReadinessManage(req: AuthedRequest) {
  const event = await resolveEventFromRequest(req);
  await requireFeature(event.id, "readiness");
  const access = await requireEventAccess(req.user!.id, event.id, { manage: true });
  return { event, access };
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

readinessRouter.get(
  "/overview",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { event } = await requireReadinessManage(req);
    const overview = await getReadinessOverview(event.id);
    return res.json({ eventId: event.id, ...overview });
  }),
);

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const templateSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(2000).nullable().optional(),
});

readinessRouter.post(
  "/templates",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = templateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationErrorBody(parsed.error));
    const { event } = await requireReadinessManage(req);
    const template = await createTemplate(event.id, event.organizationId, parsed.data);
    return res.status(201).json(template);
  }),
);

readinessRouter.patch(
  "/templates/:id",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = templateSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationErrorBody(parsed.error));
    const { event } = await requireReadinessManage(req);
    const template = await updateTemplate(event.id, req.params.id, parsed.data);
    return res.json(template);
  }),
);

// Cascade removes the template's requirements and assignments (ER3 UI adds
// the confirm step; the API is the destructive primitive).
readinessRouter.delete(
  "/templates/:id",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { event } = await requireReadinessManage(req);
    await deleteTemplate(event.id, req.params.id);
    return res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// Requirements
// ---------------------------------------------------------------------------

const requirementSchema = z.object({
  label: z.string().min(1).max(200),
  kind: z.enum(READINESS_REQUIREMENT_KINDS),
  helpText: z.string().max(2000).nullable().optional(),
  config: z.record(z.unknown()).optional(),
  required: z.boolean().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

const toRequirementInput = (data: z.infer<typeof requirementSchema>) => ({
  ...data,
  config: data.config as Record<string, unknown> | undefined,
  dueAt: data.dueAt === undefined ? undefined : data.dueAt === null ? null : new Date(data.dueAt),
});

readinessRouter.post(
  "/templates/:id/requirements",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = requirementSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationErrorBody(parsed.error));
    const { event } = await requireReadinessManage(req);
    const requirement = await createRequirement(
      event.id,
      req.params.id,
      toRequirementInput(parsed.data),
    );
    return res.status(201).json(requirement);
  }),
);

readinessRouter.patch(
  "/requirements/:id",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = requirementSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationErrorBody(parsed.error));
    const { event } = await requireReadinessManage(req);
    const requirement = await updateRequirement(event.id, req.params.id, {
      ...parsed.data,
      config: parsed.data.config as Record<string, unknown> | undefined,
      dueAt:
        parsed.data.dueAt === undefined
          ? undefined
          : parsed.data.dueAt === null
            ? null
            : new Date(parsed.data.dueAt),
    });
    return res.json(requirement);
  }),
);

readinessRouter.delete(
  "/requirements/:id",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { event } = await requireReadinessManage(req);
    await deleteRequirement(event.id, req.params.id);
    return res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// Assign a template to subjects
// ---------------------------------------------------------------------------

const assignSchema = z
  .object({
    speakerIds: z.array(z.string().min(1)).max(500).optional(),
    sessionIds: z.array(z.string().min(1)).max(500).optional(),
  })
  .refine((v) => (v.speakerIds?.length ?? 0) + (v.sessionIds?.length ?? 0) > 0, {
    message: "Provide at least one speaker or session",
  });

readinessRouter.post(
  "/templates/:id/assign",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = assignSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationErrorBody(parsed.error));
    const { event } = await requireReadinessManage(req);
    const result = await assignTemplate(
      event.id,
      event.organizationId,
      req.params.id,
      parsed.data,
    );
    return res.status(201).json(result);
  }),
);

// ---------------------------------------------------------------------------
// Assignment update — status / due-date override / owner. LATE is derived,
// never stored; WAIVED stamps waivedAt/waivedById and writes an AuditLog row.
// ---------------------------------------------------------------------------

const assignmentPatchSchema = z.object({
  status: z
    .enum([
      "NOT_STARTED",
      "IN_PROGRESS",
      "SUBMITTED",
      "NEEDS_REVIEW",
      "READY",
      "WAIVED",
      "NOT_APPLICABLE",
    ])
    .optional(),
  dueAtOverride: z.string().datetime().nullable().optional(),
  ownerUserId: z.string().min(1).max(64).nullable().optional(),
});

readinessRouter.patch(
  "/assignments/:id",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = assignmentPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationErrorBody(parsed.error));
    const { event } = await requireReadinessManage(req);
    const updated = await updateAssignment(
      event.id,
      req.params.id,
      {
        status: parsed.data.status,
        dueAtOverride:
          parsed.data.dueAtOverride === undefined
            ? undefined
            : parsed.data.dueAtOverride === null
              ? null
              : new Date(parsed.data.dueAtOverride),
        ownerUserId: parsed.data.ownerUserId,
      },
      req.user!.id,
    );
    const derived = deriveAssignmentState(updated, new Date());
    return res.json({ ...updated, late: derived.late, effectiveDueAt: derived.effectiveDueAt });
  }),
);
