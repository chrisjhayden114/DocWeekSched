/**
 * PAY-T0 — server side of organizer-run registration fees.
 *
 * Pure validation and the CSV paid-match live in @event-app/shared (used by the
 * web console too) and are re-exported here so routes and unit tests have one
 * import. This module adds the DB writes, which are all manage-gated and
 * audited by their callers, plus the payload hygiene that keeps the three
 * Event payment columns invisible while the feature is off.
 *
 * No money moves through any of this. There is no charge, no refund, no
 * balance: an organizer records what they already collected through their own
 * payment link or PO/check process.
 */

import { z } from "zod";
import { writeAuditLog } from "./ai/audit";
import { HttpError } from "./authorization";
import { prisma } from "./db";
import {
  PAYMENT_URL_MAX_CHARS,
  normalizePaymentReference,
  normalizePaymentStatus,
  normalizePaymentUrl,
  type PaymentStatus,
} from "@event-app/shared";

export {
  MARK_PAID_STATUS,
  PAYMENT_INSTRUCTIONS_MAX_CHARS,
  PAYMENT_PRICE_TEXT_MAX_CHARS,
  PAYMENT_REFERENCE_MAX_CHARS,
  PAYMENT_STATUSES,
  PAYMENT_URL_MAX_CHARS,
  PAYMENT_URL_MESSAGE,
  dryRunPaidCsv,
  isPaymentStatus,
  normalizePaymentReference,
  normalizePaymentStatus,
  normalizePaymentUrl,
  suggestPaidCsvMapping,
  type PaidCsvDryRunResult,
  type PaidCsvMapping,
  type PaidCsvRosterMember,
  type PaymentStatus,
} from "@event-app/shared";

/**
 * Zod field for paymentUrl, mirroring brandColorField: absent stays undefined
 * so the route can tell "not sent" from "sent as null", and anything present
 * is either a valid http(s) address or a 400 keyed to the paymentUrl field.
 * The check matters beyond hygiene — this value renders as a link button on a
 * public page, so a `javascript:` URL must never reach the DB.
 */
export const paymentUrlField = z
  .union([z.string().max(PAYMENT_URL_MAX_CHARS), z.null()])
  .transform((value, ctx) => {
    const result = normalizePaymentUrl(value);
    if (!result.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.error });
      return z.NEVER;
    }
    return result.url;
  })
  .optional();

/** The three Event columns the feature owns. */
export const EVENT_PAYMENT_FIELDS = [
  "paymentPriceText",
  "paymentUrl",
  "paymentInstructions",
] as const;

export type EventPaymentFieldName = (typeof EVENT_PAYMENT_FIELDS)[number];

/**
 * Off means off: an event payload never carries the organizer's fee columns
 * unless the feature is on for that event. Called on every path that spreads a
 * whole Event row to a client (GET/PUT /event, the public payload), so turning
 * the switch off makes the fields disappear rather than lingering in JSON that
 * no UI happens to read today.
 */
export function stripEventPaymentFields<T extends object>(
  event: T,
): Omit<T, EventPaymentFieldName> {
  const rest = { ...event } as Record<string, unknown>;
  for (const field of EVENT_PAYMENT_FIELDS) {
    delete rest[field];
  }
  return rest as Omit<T, EventPaymentFieldName>;
}

export type PaymentWrite = {
  status: PaymentStatus | null;
  /** undefined = leave the stored reference alone; null = clear it. */
  reference?: string | null;
};

/**
 * Validate an organizer's payment edit for one member. Kept separate from the
 * write so a bulk run can reject the whole request before touching a row.
 */
export function validatePaymentWrite(input: {
  paymentStatus?: string | null;
  paymentReference?: string | null;
}): PaymentWrite {
  const status = normalizePaymentStatus(input.paymentStatus);
  if (!status.ok) throw new HttpError(400, { error: status.error });
  if (input.paymentReference === undefined) {
    return { status: status.status };
  }
  const reference = normalizePaymentReference(input.paymentReference);
  if (!reference.ok) throw new HttpError(400, { error: reference.error });
  return { status: status.status, reference: reference.reference };
}

/**
 * Set one member's payment status (and optionally their reference). Scoped by
 * the resolved event id, so a real user id from another event is a 404 rather
 * than a cross-tenant write.
 */
export async function setMembershipPayment(params: {
  eventId: string;
  organizationId: string;
  userId: string;
  actorUserId: string;
  write: PaymentWrite;
}): Promise<{ paymentStatus: PaymentStatus | null; paymentReference: string | null }> {
  const membership = await prisma.eventMembership.findFirst({
    where: { eventId: params.eventId, userId: params.userId, deletedAt: null },
    select: { id: true, paymentStatus: true, paymentReference: true },
  });
  if (!membership) throw new HttpError(404, { error: "Not a member of this event" });

  const updated = await prisma.eventMembership.update({
    where: { id: membership.id },
    data: {
      paymentStatus: params.write.status,
      ...(params.write.reference === undefined ? {} : { paymentReference: params.write.reference }),
    },
    select: { paymentStatus: true, paymentReference: true },
  });

  await writeAuditLog({
    organizationId: params.organizationId,
    eventId: params.eventId,
    actorUserId: params.actorUserId,
    action: "OTHER",
    entityType: "EventMembership",
    entityId: membership.id,
    payload: {
      action: "payment_status_set",
      targetUserId: params.userId,
      fromStatus: membership.paymentStatus ?? null,
      toStatus: updated.paymentStatus ?? null,
      referenceChanged: params.write.reference !== undefined,
    },
  });

  return {
    paymentStatus: (updated.paymentStatus as PaymentStatus | null) ?? null,
    paymentReference: updated.paymentReference ?? null,
  };
}

export type BulkPaymentMember = { userId: string; paymentReference?: string | null };

export type BulkPaymentResult = {
  updatedCount: number;
  unchangedCount: number;
  /** Ids that matched no live seat at this event — reported, never invented. */
  notOnRoster: string[];
};

/**
 * The roster bulk bar's "Mark paid" and the CSV paid-list confirm share this
 * path. Every id is re-checked against this event's live roster: the client's
 * list is a request, not an authority. A member who already holds the target
 * status is counted as unchanged and is not re-audited, so the summary line
 * can't overstate what happened.
 */
export async function setMembershipPaymentBulk(params: {
  eventId: string;
  organizationId: string;
  actorUserId: string;
  status: PaymentStatus;
  members: BulkPaymentMember[];
  /** How the run started, for the audit trail. */
  source: "roster_bulk" | "csv_paid_list";
}): Promise<BulkPaymentResult> {
  const byUserId = new Map<string, BulkPaymentMember>();
  for (const member of params.members) {
    byUserId.set(member.userId, member);
  }
  const userIds = [...byUserId.keys()];

  const memberships = await prisma.eventMembership.findMany({
    where: { eventId: params.eventId, userId: { in: userIds }, deletedAt: null },
    select: { id: true, userId: true, paymentStatus: true },
  });
  const found = new Set(memberships.map((m) => m.userId));
  const notOnRoster = userIds.filter((id) => !found.has(id));

  const updated: { membershipId: string; userId: string; fromStatus: string | null }[] = [];
  let unchangedCount = 0;

  for (const membership of memberships) {
    const requested = byUserId.get(membership.userId)!;
    const reference = normalizePaymentReference(requested.paymentReference);
    if (!reference.ok) throw new HttpError(400, { error: reference.error });
    // A blank reference cell in a paid list means "no PO number in this file",
    // not "erase the PO number the organizer typed last week".
    const setsReference = reference.reference !== null;
    if (membership.paymentStatus === params.status && !setsReference) {
      unchangedCount += 1;
      continue;
    }
    await prisma.eventMembership.update({
      where: { id: membership.id },
      data: {
        paymentStatus: params.status,
        ...(setsReference ? { paymentReference: reference.reference } : {}),
      },
    });
    updated.push({
      membershipId: membership.id,
      userId: membership.userId,
      fromStatus: membership.paymentStatus ?? null,
    });
  }

  if (updated.length > 0 || notOnRoster.length > 0) {
    await writeAuditLog({
      organizationId: params.organizationId,
      eventId: params.eventId,
      actorUserId: params.actorUserId,
      action: "OTHER",
      entityType: "EventMembership",
      entityId: params.eventId,
      payload: {
        action: "payment_status_bulk",
        source: params.source,
        toStatus: params.status,
        updated: updated.map((u) => ({ userId: u.userId, fromStatus: u.fromStatus })),
        unchangedCount,
        notOnRoster,
      },
    });
  }

  return { updatedCount: updated.length, unchangedCount, notOnRoster };
}

/** The roster rows a CSV paid-list is matched against. */
export async function loadPaidCsvRoster(eventId: string) {
  const members = await prisma.eventMembership.findMany({
    where: { eventId, deletedAt: null },
    select: {
      userId: true,
      paymentStatus: true,
      user: { select: { name: true, email: true } },
    },
  });
  return members.map((m) => ({
    userId: m.userId,
    email: m.user.email,
    name: m.user.name,
    paymentStatus: m.paymentStatus ?? null,
  }));
}
