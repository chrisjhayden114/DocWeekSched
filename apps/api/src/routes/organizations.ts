import { OrgRole } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler, requireOrgRole } from "../lib/authorization";
import { prisma } from "../lib/db";
import { uiEventStatus } from "../lib/eventStatus";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";
import { validationErrorBody } from "../lib/errors";

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
