import { OrgRole } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { writeAuditLog } from "../lib/ai/audit";
import { asyncHandler, requireOrgRole } from "../lib/authorization";
import { prisma } from "../lib/db";
import { uiEventStatus } from "../lib/eventStatus";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";
import { validationErrorBody } from "../lib/errors";
import {
  ORG_IDENTITY_SELECT,
  orgIdentityUpdateData,
  orgUpdateSchema,
} from "../lib/orgIdentity";

export const organizationsRouter = Router();

const createOrgSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(2)
    .max(72)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional(),
});

async function ensureUniqueOrgSlug(base: string): Promise<string> {
  let candidate = base.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "org";
  let n = 0;
  while (await prisma.organization.findUnique({ where: { slug: candidate } })) {
    n += 1;
    candidate = `${base.slice(0, 40)}-${n}`;
  }
  return candidate;
}

organizationsRouter.get(
  "/mine",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const memberships = await prisma.orgMembership.findMany({
      where: { userId: req.user!.id },
      include: {
        organization: {
          include: {
            _count: { select: { events: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });
    return res.json(
      memberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        role: m.role,
        eventCount: m.organization._count.events,
        plan: m.organization.plan,
        subscriptionStatus: m.organization.subscriptionStatus,
      })),
    );
  }),
);

organizationsRouter.post(
  "/",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = createOrgSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(validationErrorBody(parsed.error));
    }
    const slugBase =
      parsed.data.slug?.trim().toLowerCase() ||
      parsed.data.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 48) ||
      "org";
    const slug = await ensureUniqueOrgSlug(slugBase);
    const org = await prisma.organization.create({
      data: {
        name: parsed.data.name.trim(),
        slug,
        plan: "FREE",
        eventAllowance: 1,
        memberships: {
          create: { userId: req.user!.id, role: OrgRole.OWNER },
        },
      },
    });
    return res.status(201).json({
      id: org.id,
      name: org.name,
      slug: org.slug,
      role: OrgRole.OWNER,
      plan: org.plan,
    });
  }),
);

/**
 * ORG-1 — the organization's own identity, for the settings page and for the
 * create-event wizard's logo prefill. STAFF may read it (the wizard prefill
 * needs it and STAFF can create events); only ADMIN and OWNER may write.
 */
organizationsRouter.get(
  "/:orgId",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { membershipRole } = await requireOrgRole(req.user!.id, req.params.orgId, OrgRole.STAFF);
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: req.params.orgId },
      select: ORG_IDENTITY_SELECT,
    });
    return res.json({ ...org, role: membershipRole });
  }),
);

organizationsRouter.put(
  "/:orgId",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    // Role first: someone who may not write here learns nothing about the
    // body's shape from a validation error.
    await requireOrgRole(req.user!.id, req.params.orgId, OrgRole.ADMIN);

    // The update is built from an allow-list, so slug, plan, and every billing
    // column are unreachable from here no matter what the body carries.
    // Transfer-ownership and close-org are ORG-2 and have no route yet.
    const parsed = orgUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(validationErrorBody(parsed.error));
    }

    const update = orgIdentityUpdateData(parsed.data);
    if (!update.ok) {
      return res.status(400).json({ error: update.error, code: "VALIDATION" });
    }

    const org = await prisma.organization.update({
      where: { id: req.params.orgId },
      data: update.data,
      select: ORG_IDENTITY_SELECT,
    });

    await writeAuditLog({
      organizationId: org.id,
      actorUserId: req.user!.id,
      action: "OTHER",
      entityType: "Organization",
      entityId: org.id,
      payload: {
        action: "org_identity_saved",
        fields: Object.keys(update.data),
      },
    });

    return res.json(org);
  }),
);

organizationsRouter.get(
  "/:orgId/events",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    await requireOrgRole(req.user!.id, req.params.orgId, OrgRole.STAFF);
    const events = await prisma.event.findMany({
      where: { organizationId: req.params.orgId },
      orderBy: { startDate: "desc" },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        startDate: true,
        endDate: true,
        timezone: true,
        brandColor: true,
        logoUrl: true,
        seriesId: true,
        description: true,
      },
    });
    return res.json(
      events.map((e) => ({
        ...e,
        uiStatus: uiEventStatus(e),
      })),
    );
  }),
);
