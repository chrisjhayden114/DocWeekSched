import type { NextFunction, Response } from "express";
import { OrgRole, EventMemberRole, type Event, type Organization } from "@prisma/client";
import { prisma } from "./db";
import type { AuthedRequest } from "./middleware";

export class HttpError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : "Error");
    this.status = status;
    this.body = body;
  }
}

const ORG_RANK: Record<OrgRole, number> = {
  STAFF: 1,
  ADMIN: 2,
  OWNER: 3,
};

export function orgRoleAtLeast(actual: OrgRole, minimum: OrgRole): boolean {
  return ORG_RANK[actual] >= ORG_RANK[minimum];
}

export type EventAccess = {
  event: Event & { organization: Organization };
  orgRole: OrgRole | null;
  eventRole: EventMemberRole | null;
  isOrgStaff: boolean;
  isEventAdmin: boolean;
  canManageEvent: boolean;
  /** EventMembership.REVIEWER — never grants canManageEvent. */
  isEventReviewer: boolean;
};

/**
 * Require the caller to hold at least `minimum` org role on the organization.
 * OWNER > ADMIN > STAFF.
 */
export async function requireOrgRole(
  userId: string,
  orgId: string,
  minimum: OrgRole,
): Promise<{ membershipRole: OrgRole; organization: Organization }> {
  const membership = await prisma.orgMembership.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId } },
    include: { organization: true },
  });
  if (!membership || !orgRoleAtLeast(membership.role, minimum)) {
    throw new HttpError(403, { error: "Forbidden" });
  }
  return { membershipRole: membership.role, organization: membership.organization };
}

export type EventAccessOptions = {
  /** Require event membership or org staff (default true for attendee surfaces). */
  requireMembership?: boolean;
  /** Require ability to manage event (org STAFF+ or event ADMIN). */
  manage?: boolean;
  /** OWNER-only (e.g. grant admin-access requests). */
  ownerOnly?: boolean;
};

/**
 * Resolve an event and authorize the user against org + event membership.
 * Does not trust client role claims — loads memberships from the DB.
 */
export async function requireEventAccess(
  userId: string,
  eventId: string,
  opts: EventAccessOptions = {},
): Promise<EventAccess> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { organization: true },
  });
  if (!event) {
    throw new HttpError(404, { error: "Event not found" });
  }

  const [orgMembership, eventMembershipRaw] = await Promise.all([
    prisma.orgMembership.findUnique({
      where: { organizationId_userId: { organizationId: event.organizationId, userId } },
    }),
    prisma.eventMembership.findUnique({
      where: { eventId_userId: { eventId, userId } },
    }),
  ]);

  const eventMembership = eventMembershipRaw?.deletedAt ? null : eventMembershipRaw;

  const orgRole = orgMembership?.role ?? null;
  const eventRole = eventMembership?.role ?? null;
  const isOrgStaff = orgRole != null && orgRoleAtLeast(orgRole, OrgRole.STAFF);
  /** REVIEWER must never receive manage rights (billing / rosters / settings). */
  const isEventAdmin = eventRole === EventMemberRole.ADMIN || isOrgStaff;
  const isEventReviewer = eventRole === EventMemberRole.REVIEWER;
  const canManageEvent = isEventAdmin;

  if (opts.ownerOnly) {
    if (orgRole !== OrgRole.OWNER) {
      throw new HttpError(403, { error: "Forbidden" });
    }
  } else if (opts.manage) {
    if (!canManageEvent) {
      throw new HttpError(403, { error: "Forbidden" });
    }
  } else if (opts.requireMembership !== false) {
    if (!eventMembership && !isOrgStaff) {
      throw new HttpError(403, { error: "Forbidden" });
    }
  }

  return {
    event,
    orgRole,
    eventRole,
    isOrgStaff,
    isEventAdmin,
    canManageEvent,
    isEventReviewer,
  };
}

/**
 * CFP organizer manage (create form, assign reviewers, decisions) —
 * org STAFF+ or event ADMIN only. REVIEWER is never enough.
 */
export async function requireCfpManage(userId: string, eventId: string): Promise<EventAccess> {
  return requireEventAccess(userId, eventId, { manage: true });
}

/**
 * Reviewer access to a CFP form: event/org managers, or listed CfpReviewer.
 * Does not grant canManageEvent for pure REVIEWER memberships.
 */
export async function requireCfpReviewer(
  userId: string,
  cfpFormId: string,
): Promise<{
  access: EventAccess;
  form: { id: string; eventId: string; blindReview: boolean; rubric: unknown; title: string };
  isManager: boolean;
}> {
  const form = await prisma.cfpForm.findUnique({
    where: { id: cfpFormId },
    select: { id: true, eventId: true, blindReview: true, rubric: true, title: true },
  });
  if (!form) throw new HttpError(404, { error: "CFP not found" });

  const access = await requireEventAccess(userId, form.eventId, { requireMembership: false });
  const isManager = access.canManageEvent;
  if (isManager) {
    return { access, form, isManager: true };
  }

  const listed = await prisma.cfpReviewer.findUnique({
    where: { cfpFormId_userId: { cfpFormId, userId } },
  });
  if (!listed) {
    throw new HttpError(403, { error: "Forbidden" });
  }
  return { access, form, isManager: false };
}

export function asyncHandler(
  fn: (req: AuthedRequest, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    fn(req, res, next).catch((err) => {
      if (err instanceof HttpError) {
        return res.status(err.status).json(err.body);
      }
      return next(err);
    });
  };
}
