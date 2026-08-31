/**
 * ORG-2 — server side of the organization lifecycle: hand it over, close it,
 * and move a draft event out of it.
 *
 * The rules and the copy live in @event-app/shared so the danger-zone button
 * and the route agree; this module is the part that has to touch the database.
 */

import { EventStatus, OrgRole, type Prisma } from "@prisma/client";
import {
  ORG_CLOSE_ALREADY_CLOSED_MESSAGE,
  type EventTransferBlocker,
  type OrgCloseBlocker,
} from "@event-app/shared";
import { prisma } from "./db";
import { HttpError } from "./authorization";

/* ------------------------------------------------------------------ *
 * Closed organizations
 * ------------------------------------------------------------------ */

/**
 * A closed organization is inert, not gone. Every write path that could bring
 * it back to life goes through here rather than trusting a membership row: the
 * memberships survive the close on purpose, so support can still see who ran it.
 */
export function assertOrgOpen(org: { id: string; closedAt: Date | null }): void {
  if (org.closedAt) {
    throw new HttpError(409, {
      error: ORG_CLOSE_ALREADY_CLOSED_MESSAGE,
      code: "ORG_CLOSED",
      organizationId: org.id,
    });
  }
}

export async function loadOpenOrgOrThrow(orgId: string) {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, closedAt: true, plan: true, subscriptionStatus: true },
  });
  if (!org) throw new HttpError(404, { error: "Organization not found" });
  assertOrgOpen(org);
  return org;
}

/* ------------------------------------------------------------------ *
 * Close eligibility
 * ------------------------------------------------------------------ */

export type OrgCloseState = {
  organizationId: string;
  name: string;
  closedAt: Date | null;
  blockers: OrgCloseBlocker[];
  canClose: boolean;
  /** For the confirmation copy: what closing actually takes with it. */
  draftEventCount: number;
  archivedEventCount: number;
  otherMemberCount: number;
};

/**
 * "Empty of live substance" (DESIGN_PHASE_J, ORG-2), counted rather than
 * asserted, so the refusal can name every reason at once instead of the first
 * one it trips over.
 *
 * Money, certificates and metered AI block a self-service close even though
 * closing deletes nothing: those records are an obligation to somebody outside
 * this account — an attendee who can still verify a certificate, an invoice
 * someone has to be able to find — and an owner walking away should hand the
 * organization to a person, not leave it unreachable.
 */
export async function loadOrgCloseState(orgId: string): Promise<OrgCloseState> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      name: true,
      closedAt: true,
      plan: true,
      subscriptionStatus: true,
      _count: { select: { memberships: true } },
    },
  });
  if (!org) throw new HttpError(404, { error: "Organization not found" });

  const [publishedEvents, draftEventCount, archivedEventCount, purchases, certificates, aiUsage] =
    await Promise.all([
      prisma.event.findMany({
        where: { organizationId: orgId, status: EventStatus.ACTIVE },
        select: { name: true },
        orderBy: { startDate: "asc" },
        take: 25,
      }),
      prisma.event.count({ where: { organizationId: orgId, status: EventStatus.DRAFT } }),
      prisma.event.count({ where: { organizationId: orgId, status: EventStatus.ARCHIVED } }),
      prisma.eventPurchase.count({ where: { organizationId: orgId } }),
      prisma.issuedCertificate.count({ where: { organizationId: orgId } }),
      prisma.aiUsageRecord.count({ where: { organizationId: orgId } }),
    ]);

  const blockers: OrgCloseBlocker[] = [];
  if (publishedEvents.length > 0) {
    blockers.push({
      kind: "PUBLISHED_EVENTS",
      count: publishedEvents.length,
      names: publishedEvents.map((e) => e.name),
    });
  }
  if (purchases > 0) blockers.push({ kind: "PURCHASES", count: purchases });
  if (certificates > 0) blockers.push({ kind: "CERTIFICATES", count: certificates });
  if (aiUsage > 0) blockers.push({ kind: "AI_USAGE", count: aiUsage });
  // Not in the ORG-2 brief, but closing an org whose card is still on file
  // would leave someone paying for a workspace they were told was shut.
  if (
    org.plan !== "INTERNAL" &&
    (org.subscriptionStatus === "ACTIVE" ||
      org.subscriptionStatus === "TRIALING" ||
      org.subscriptionStatus === "PAST_DUE")
  ) {
    blockers.push({ kind: "ACTIVE_SUBSCRIPTION", count: 1 });
  }

  return {
    organizationId: org.id,
    name: org.name,
    closedAt: org.closedAt,
    blockers,
    canClose: blockers.length === 0 && org.closedAt == null,
    draftEventCount,
    archivedEventCount,
    otherMemberCount: Math.max(0, org._count.memberships - 1),
  };
}

/* ------------------------------------------------------------------ *
 * Draft-only event transfer — every denormalized organizationId
 * ------------------------------------------------------------------ */

type Tx = Prisma.TransactionClient;

/**
 * Every table that denormalizes organizationId alongside an eventId.
 *
 * This list is the reason a general event transfer was refused in J-A: 17
 * models carry organizationId, and a move that updates the Event row alone
 * leaves the other sixteen pointing at the old organization — which is how
 * billing, metering and audit silently corrupt. Two of these
 * (ReadinessAssignment, ReadinessPortalAccess) carry organizationId with **no
 * foreign key at all**, so nothing in the database would have complained.
 *
 * orgLifecycle.unit.test.ts reads schema.prisma and fails if a model gains
 * organizationId + eventId without being added here, so "miss none" is checked
 * by the build rather than by memory.
 *
 * Deliberately excluded, and why:
 * - Event — moved by the caller itself, not as a child row.
 * - OrgMembership, EventSeries — org-scoped, no eventId. A series member can't
 *   transfer at all (SERIES blocker), so no series row ever needs to follow.
 */
export const EVENT_ORGANIZATION_CHILD_TABLES = [
  "EventPurchase",
  "AdminAccessRequest",
  "AiUsageRecord",
  "AuditLog",
  "BackgroundJob",
  "AgendaIngestRun",
  "OpsInboxCard",
  "BadgeTemplate",
  "CertificateTemplate",
  "IssuedCertificate",
  "EventRecap",
  "ReadinessTemplate",
  "ReadinessAssignment",
  "ReadinessPortalAccess",
] as const;

export type EventOrganizationChildTable = (typeof EVENT_ORGANIZATION_CHILD_TABLES)[number];

/**
 * One updater per table above. Written out rather than looped over a string
 * index so the compiler checks every model and column name — a typo here would
 * otherwise be exactly the silent orphan this whole route exists to prevent.
 */
const CHILD_UPDATERS: ReadonlyArray<{
  table: EventOrganizationChildTable;
  move: (tx: Tx, eventId: string, organizationId: string) => Promise<{ count: number }>;
}> = [
  {
    table: "EventPurchase",
    move: (tx, eventId, organizationId) =>
      tx.eventPurchase.updateMany({ where: { eventId }, data: { organizationId } }),
  },
  {
    table: "AdminAccessRequest",
    move: (tx, eventId, organizationId) =>
      tx.adminAccessRequest.updateMany({ where: { eventId }, data: { organizationId } }),
  },
  {
    table: "AiUsageRecord",
    move: (tx, eventId, organizationId) =>
      tx.aiUsageRecord.updateMany({ where: { eventId }, data: { organizationId } }),
  },
  {
    table: "AuditLog",
    move: (tx, eventId, organizationId) =>
      tx.auditLog.updateMany({ where: { eventId }, data: { organizationId } }),
  },
  {
    table: "BackgroundJob",
    move: (tx, eventId, organizationId) =>
      tx.backgroundJob.updateMany({ where: { eventId }, data: { organizationId } }),
  },
  {
    table: "AgendaIngestRun",
    move: (tx, eventId, organizationId) =>
      tx.agendaIngestRun.updateMany({ where: { eventId }, data: { organizationId } }),
  },
  {
    table: "OpsInboxCard",
    move: (tx, eventId, organizationId) =>
      tx.opsInboxCard.updateMany({ where: { eventId }, data: { organizationId } }),
  },
  {
    table: "BadgeTemplate",
    move: (tx, eventId, organizationId) =>
      tx.badgeTemplate.updateMany({ where: { eventId }, data: { organizationId } }),
  },
  {
    table: "CertificateTemplate",
    move: (tx, eventId, organizationId) =>
      tx.certificateTemplate.updateMany({ where: { eventId }, data: { organizationId } }),
  },
  {
    table: "IssuedCertificate",
    move: (tx, eventId, organizationId) =>
      tx.issuedCertificate.updateMany({ where: { eventId }, data: { organizationId } }),
  },
  {
    table: "EventRecap",
    move: (tx, eventId, organizationId) =>
      tx.eventRecap.updateMany({ where: { eventId }, data: { organizationId } }),
  },
  {
    table: "ReadinessTemplate",
    move: (tx, eventId, organizationId) =>
      tx.readinessTemplate.updateMany({ where: { eventId }, data: { organizationId } }),
  },
  {
    table: "ReadinessAssignment",
    move: (tx, eventId, organizationId) =>
      tx.readinessAssignment.updateMany({ where: { eventId }, data: { organizationId } }),
  },
  {
    table: "ReadinessPortalAccess",
    move: (tx, eventId, organizationId) =>
      tx.readinessPortalAccess.updateMany({ where: { eventId }, data: { organizationId } }),
  },
];

if (CHILD_UPDATERS.length !== EVENT_ORGANIZATION_CHILD_TABLES.length) {
  throw new Error("ORG-2: CHILD_UPDATERS and EVENT_ORGANIZATION_CHILD_TABLES disagree");
}

export type EventTransferState = {
  eventId: string;
  eventName: string;
  organizationId: string;
  status: EventStatus;
  blockers: EventTransferBlocker[];
  canTransfer: boolean;
};

function uiStatusWord(status: EventStatus): string {
  return status === EventStatus.ACTIVE ? "published" : "archived";
}

/**
 * The four disqualifiers from DESIGN_PHASE_J plus the draft gate, counted
 * together so a refusal can list all of them.
 */
export async function loadEventTransferState(eventId: string): Promise<EventTransferState> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      name: true,
      status: true,
      organizationId: true,
      seriesId: true,
      series: { select: { name: true } },
    },
  });
  if (!event) throw new HttpError(404, { error: "Event not found" });

  const [purchases, certificates, aiUsage] = await Promise.all([
    prisma.eventPurchase.count({ where: { eventId } }),
    prisma.issuedCertificate.count({ where: { eventId } }),
    prisma.aiUsageRecord.count({ where: { eventId } }),
  ]);

  const blockers: EventTransferBlocker[] = [];
  if (event.status !== EventStatus.DRAFT) {
    blockers.push({ kind: "NOT_DRAFT", count: 1, detail: uiStatusWord(event.status) });
  }
  if (purchases > 0) blockers.push({ kind: "PURCHASES", count: purchases });
  if (certificates > 0) blockers.push({ kind: "CERTIFICATES", count: certificates });
  if (aiUsage > 0) blockers.push({ kind: "AI_USAGE", count: aiUsage });
  if (event.seriesId) {
    blockers.push({ kind: "SERIES", count: 1, detail: event.series?.name ?? undefined });
  }

  return {
    eventId: event.id,
    eventName: event.name,
    organizationId: event.organizationId,
    status: event.status,
    blockers,
    canTransfer: blockers.length === 0,
  };
}

export type EventTransferResult = {
  eventId: string;
  fromOrganizationId: string;
  toOrganizationId: string;
  /** Rows rewritten per table — the audit payload, and what the db test reads. */
  movedRows: Record<string, number>;
};

/**
 * Move the event and every row that denormalizes its organization, in one
 * transaction. Either the whole event lives in the new organization or none of
 * it does; a partial move is the corruption J-A refused to risk.
 */
export async function moveEventToOrganization(input: {
  eventId: string;
  fromOrganizationId: string;
  toOrganizationId: string;
}): Promise<EventTransferResult> {
  const { eventId, fromOrganizationId, toOrganizationId } = input;

  const movedRows = await prisma.$transaction(async (tx) => {
    // Re-read under the transaction: eligibility was checked before this point,
    // and a publish landing in between must not be overtaken by a move.
    const fresh = await tx.event.findUnique({
      where: { id: eventId },
      select: { status: true, organizationId: true, seriesId: true },
    });
    if (!fresh || fresh.organizationId !== fromOrganizationId) {
      throw new HttpError(409, { error: "The event moved while you were working. Reload and try again." });
    }
    if (fresh.status !== EventStatus.DRAFT || fresh.seriesId) {
      throw new HttpError(409, { error: "The event is no longer a draft, so it can't move." });
    }

    const counts: Record<string, number> = {};
    for (const updater of CHILD_UPDATERS) {
      const result = await updater.move(tx, eventId, toOrganizationId);
      counts[updater.table] = result.count;
    }
    await tx.event.update({
      where: { id: eventId },
      data: { organizationId: toOrganizationId },
    });
    counts.Event = 1;
    return counts;
  });

  return { eventId, fromOrganizationId, toOrganizationId, movedRows };
}

/* ------------------------------------------------------------------ *
 * Transfer ownership
 * ------------------------------------------------------------------ */

export type OrgMemberSummary = {
  userId: string;
  name: string | null;
  email: string;
  role: OrgRole;
  isSelf: boolean;
};

export async function listOrgMembers(orgId: string, selfUserId: string): Promise<OrgMemberSummary[]> {
  const rows = await prisma.orgMembership.findMany({
    where: { organizationId: orgId },
    select: {
      role: true,
      userId: true,
      user: { select: { name: true, email: true, deactivatedAt: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return rows
    // An account already on its way out must not be handed an organization.
    .filter((row) => row.user.deactivatedAt == null)
    .map((row) => ({
      userId: row.userId,
      name: row.user.name,
      email: row.user.email,
      role: row.role,
      isSelf: row.userId === selfUserId,
    }));
}

/**
 * Swap the two membership rows in one transaction: an organization with two
 * owners, or none, is worse than a failed transfer.
 */
export async function transferOrgOwnership(input: {
  organizationId: string;
  fromUserId: string;
  toUserId: string;
}): Promise<void> {
  const { organizationId, fromUserId, toUserId } = input;
  await prisma.$transaction(async (tx) => {
    const target = await tx.orgMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId: toUserId } },
      select: { role: true },
    });
    if (!target || target.role !== OrgRole.ADMIN) {
      throw new HttpError(409, { error: "That person is no longer an admin here. Reload and try again." });
    }
    await tx.orgMembership.update({
      where: { organizationId_userId: { organizationId, userId: toUserId } },
      data: { role: OrgRole.OWNER },
    });
    await tx.orgMembership.update({
      where: { organizationId_userId: { organizationId, userId: fromUserId } },
      data: { role: OrgRole.ADMIN },
    });
  });
}
