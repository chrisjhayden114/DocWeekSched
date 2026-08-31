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
import {
  ORG_CLOSE_BLOCKED_MESSAGE,
  ORG_TRANSFER_TARGET_NOT_ADMIN_MESSAGE,
  ORG_TRANSFER_TARGET_NOT_MEMBER_MESSAGE,
  ORG_TRANSFER_TARGET_ROLE,
  ORG_TRANSFER_TO_SELF_MESSAGE,
  describeOrgCloseBlockers,
  isEligibleTransferTarget,
  orgCloseConfirmationLabel,
  orgCloseConfirmationMatches,
} from "@event-app/shared";
import {
  assertOrgOpen,
  listOrgMembers,
  loadOrgCloseState,
  transferOrgOwnership,
} from "../lib/orgLifecycle";

export const organizationsRouter = Router();

const transferOwnershipSchema = z.object({
  newOwnerUserId: z.string().min(1),
});

const closeOrgSchema = z.object({
  /** Typed organization name — the deliberate step, checked server-side too. */
  confirmName: z.string().min(1).max(200),
});

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
      // ORG-2 — a closed organization keeps its memberships (support still
      // needs to see who ran it) but leaves every console surface that reads
      // this list: the org picker, the wizard, billing, and the login redirect.
      where: { userId: req.user!.id, organization: { closedAt: null } },
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
    const { organization } = await requireOrgRole(req.user!.id, req.params.orgId, OrgRole.ADMIN);
    assertOrgOpen(organization);

    // The update is built from an allow-list, so slug, plan, and every billing
    // column are unreachable from here no matter what the body carries.
    // Ownership and closure move through their own ORG-2 routes below.
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

/**
 * ORG-2 — who is in this organization, for the transfer-ownership picker.
 *
 * ADMIN+ only: a STAFF member has no business enumerating their colleagues'
 * addresses, and the only caller is the danger zone.
 */
organizationsRouter.get(
  "/:orgId/members",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    await requireOrgRole(req.user!.id, req.params.orgId, OrgRole.ADMIN);
    const members = await listOrgMembers(req.params.orgId, req.user!.id);
    return res.json({ members, transferTargetRole: ORG_TRANSFER_TARGET_ROLE });
  }),
);

/**
 * ORG-2 — hand the organization to an existing ADMIN.
 *
 * The target must already be an ADMIN. That is not a technical limit: it keeps
 * the act deliberate, so handing over an organization is a decision someone
 * already made once (when they promoted them) rather than a single click
 * against a list of everyone who ever joined.
 */
organizationsRouter.post(
  "/:orgId/transfer-ownership",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { organization } = await requireOrgRole(req.user!.id, req.params.orgId, OrgRole.OWNER);
    assertOrgOpen(organization);

    const parsed = transferOwnershipSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(validationErrorBody(parsed.error));
    }
    const newOwnerUserId = parsed.data.newOwnerUserId;
    if (newOwnerUserId === req.user!.id) {
      return res.status(400).json({ error: ORG_TRANSFER_TO_SELF_MESSAGE, code: "TRANSFER_TO_SELF" });
    }

    const target = await prisma.orgMembership.findUnique({
      where: { organizationId_userId: { organizationId: organization.id, userId: newOwnerUserId } },
      select: { role: true, user: { select: { name: true, email: true, deactivatedAt: true } } },
    });
    if (!target || target.user.deactivatedAt) {
      return res
        .status(404)
        .json({ error: ORG_TRANSFER_TARGET_NOT_MEMBER_MESSAGE, code: "TARGET_NOT_MEMBER" });
    }
    if (!isEligibleTransferTarget(target.role)) {
      return res.status(409).json({
        error: ORG_TRANSFER_TARGET_NOT_ADMIN_MESSAGE,
        code: "TARGET_NOT_ADMIN",
        currentRole: target.role,
      });
    }

    await transferOrgOwnership({
      organizationId: organization.id,
      fromUserId: req.user!.id,
      toUserId: newOwnerUserId,
    });

    await writeAuditLog({
      organizationId: organization.id,
      actorUserId: req.user!.id,
      action: "OTHER",
      entityType: "Organization",
      entityId: organization.id,
      payload: {
        action: "org_ownership_transferred",
        previousOwnerUserId: req.user!.id,
        newOwnerUserId,
        previousOwnerRoleAfter: OrgRole.ADMIN,
      },
    });

    return res.json({
      ok: true,
      organizationId: organization.id,
      newOwnerUserId,
      yourRole: OrgRole.ADMIN,
      message: `${target.user.name || target.user.email} now owns ${organization.name}. You are an admin here.`,
    });
  }),
);

/**
 * ORG-2 — what would block closing, itemized. The danger zone reads this so it
 * can show the reasons before anyone clicks, rather than only after.
 */
organizationsRouter.get(
  "/:orgId/close",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    await requireOrgRole(req.user!.id, req.params.orgId, OrgRole.OWNER);
    const state = await loadOrgCloseState(req.params.orgId);
    return res.json({
      ...state,
      closedAt: state.closedAt?.toISOString() ?? null,
      reasons: describeOrgCloseBlockers(state.blockers),
    });
  }),
);

/**
 * ORG-2 — close the organization for good.
 *
 * This is the route that unblocks account deletion for a solo owner. It is not
 * a delete: Event.organizationId is onDelete: Restrict and a closeable
 * organization may still hold archived events, whose attendee records are not
 * the owner's to destroy. So the workspace ends and the rows stay.
 */
organizationsRouter.post(
  "/:orgId/close",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { organization } = await requireOrgRole(req.user!.id, req.params.orgId, OrgRole.OWNER);
    assertOrgOpen(organization);

    const parsed = closeOrgSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(validationErrorBody(parsed.error));
    }
    // The typed name is checked on the server too: the client gate is a
    // courtesy, and this one is the guarantee that a scripted POST cannot close
    // the wrong organization by id alone.
    if (!orgCloseConfirmationMatches(parsed.data.confirmName, organization.name)) {
      return res.status(400).json({
        error: orgCloseConfirmationLabel(organization.name),
        code: "CONFIRM_NAME_MISMATCH",
      });
    }

    const state = await loadOrgCloseState(organization.id);
    if (!state.canClose) {
      return res.status(409).json({
        error: ORG_CLOSE_BLOCKED_MESSAGE,
        code: "ORG_NOT_EMPTY",
        blockers: state.blockers,
        reasons: describeOrgCloseBlockers(state.blockers),
      });
    }

    const closedAt = new Date();
    await prisma.organization.update({
      where: { id: organization.id },
      data: { closedAt, closedByUserId: req.user!.id },
    });

    await writeAuditLog({
      organizationId: organization.id,
      actorUserId: req.user!.id,
      action: "OTHER",
      entityType: "Organization",
      entityId: organization.id,
      payload: {
        action: "org_closed",
        closedAt: closedAt.toISOString(),
        draftEventCount: state.draftEventCount,
        archivedEventCount: state.archivedEventCount,
        otherMemberCount: state.otherMemberCount,
      },
    });

    return res.json({
      ok: true,
      organizationId: organization.id,
      closedAt: closedAt.toISOString(),
      message: `${organization.name} is closed. It no longer appears in your console, and it no longer blocks deleting your account.`,
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
