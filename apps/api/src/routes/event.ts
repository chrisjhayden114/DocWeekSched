import { EventMemberRole, EventStatus, OrgRole } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import {
  EVENT_TRANSFER_BLOCKED_MESSAGE,
  EVENT_TRANSFER_RECOMMENDATION,
  EVENT_TRANSFER_SAME_ORG_MESSAGE,
  EVENT_TRANSFER_TARGET_ROLE_MESSAGE,
  describeEventTransferBlockers,
  eventLogoWithOrgFallback,
} from "@event-app/shared";
import {
  asyncHandler,
  orgRoleAtLeast,
  requireEventAccess,
  requireOrgRole,
} from "../lib/authorization";
import { prisma } from "../lib/db";
import { env } from "../lib/env";
import {
  ensureEventJoinToken,
  isJoinLinkActive,
  isSlugLinkActive,
  regenerateJoinToken,
  regenerateSlug,
} from "../lib/inviteTokens";
import { isPubliclyJoinable, uiEventStatus } from "../lib/eventStatus";
import { getPublicEventBySlug } from "../lib/publicEvent";
import { authRateLimit, publicRateLimit } from "../lib/rateLimit";
import { ensureUniqueEventSlug, slugifyEventBase } from "../lib/slug";
import { resolveEventFromRequest } from "../lib/requestEvent";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";
import { hashToken } from "../lib/auth";
import { validationErrorBody } from "../lib/errors";
import { revokePortalAccessForEvent } from "../lib/readiness/portal";
import { brandColorField } from "../lib/brandColor";
import { patchFields, trimmedOrNull } from "../lib/patchFields";
import { saveEventParticipantLabels, toEventClient } from "../lib/participantLabels";
import {
  PAYMENT_INSTRUCTIONS_MAX_CHARS,
  PAYMENT_PRICE_TEXT_MAX_CHARS,
  paymentUrlField,
  stripEventPaymentFields,
} from "../lib/paidAttendance";
import { featureEnabled, requireFeature } from "../lib/features";
import {
  EVENT_ORGANIZATION_TRANSFER_ERROR,
  eventUpdateIncludesOrganizationId,
} from "../lib/eventOrganization";
import {
  assertOrgOpen,
  loadEventTransferState,
  moveEventToOrganization,
} from "../lib/orgLifecycle";

export const eventRouter = Router();

/**
 * FIX-NULL (BRAND-2 generalized) — every nullable text column on the event is
 * patch-shaped on update: a field the client did not send is left alone, and
 * only an explicit null (or an emptied text box) clears it. BRAND-2 fixed the
 * three branding columns after a name-only settings save wiped an organizer's
 * colour, logo, and banner; the venue and description columns beside them had
 * the same defect.
 */
const EVENT_PATCH_FIELDS = [
  "description",
  "venueName",
  "venueAddress",
  "onlineUrl",
  // brandColor arrives already normalized (or nulled) from brandColorField.
  "brandColor",
  "bannerUrl",
  "logoUrl",
  // PAY-T0: same patch contract. paymentUrl arrives validated (or nulled) from
  // paymentUrlField and is handled separately below.
  "paymentPriceText",
  "paymentInstructions",
  // K-2 — custom CFP display name. Absent = keep, null/blank = default label.
  "cfpLabel",
] as const;

/** PAY-T0 — the payment fields, for the feature gate on writes. */
const EVENT_PAYMENT_PATCH_KEYS = [
  "paymentPriceText",
  "paymentUrl",
  "paymentInstructions",
] as const;

/**
 * PAY-T0 — the fee columns exist on the row for every event, so the payload is
 * where "off means off" is enforced: with the feature off, an event payload
 * carries no payment fields at all rather than nulls that a future UI might
 * start reading.
 */
async function withPaymentVisibility<T extends object>(client: T, eventId: string) {
  const on = await featureEnabled(eventId, "paid_attendance");
  return on ? client : stripEventPaymentFields(client);
}

const slugField = z
  .string()
  .min(2)
  .max(72)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .optional();

const eventSchema = z.object({
  name: z.string().min(1),
  slug: slugField,
  description: z.string().max(20_000).optional().nullable(),
  venueName: z.string().max(200).optional().nullable(),
  venueAddress: z.string().max(500).optional().nullable(),
  onlineUrl: z.string().max(2000).optional().nullable(),
  brandColor: brandColorField,
  bannerUrl: z.string().max(12_000_000).optional().nullable(),
  logoUrl: z.string().max(12_000_000).optional().nullable(),
  timezone: z.string().min(1),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  organizationId: z.string().optional(),
  // PART-1 — patch-shaped: absent = untouched, null/[] = cleared.
  participantLabels: z.array(z.string()).nullable().optional(),
  // PAY-T0 — the organizer's own registration fee. Writing any of these needs
  // the paid_attendance feature to be on for this event.
  paymentPriceText: z.string().max(PAYMENT_PRICE_TEXT_MAX_CHARS).optional().nullable(),
  paymentUrl: paymentUrlField,
  paymentInstructions: z.string().max(PAYMENT_INSTRUCTIONS_MAX_CHARS).optional().nullable(),
  // K-2 — organizer-facing CFP name. Empty/null clears back to the default.
  cfpLabel: z.string().max(60).optional().nullable(),
});

const publicEventSelect = {
  id: true,
  name: true,
  slug: true,
  bannerUrl: true,
  logoUrl: true,
  brandColor: true,
  description: true,
  timezone: true,
  startDate: true,
  endDate: true,
  status: true,
  // ORG-1 — for displayLogoUrl only. The event's own logoUrl is still what
  // every writer reads and writes.
  organization: { select: { logoUrl: true } },
} as const;

/**
 * ORG-1 — the logo a surface should actually render: the event's own, or the
 * organization's when the event never chose one.
 *
 * Read-time only. No event row is ever stamped with the org's logo, so an
 * organizer who replaces the org crest updates every event that borrowed it,
 * and an event that picked its own mark is untouched forever. The event's raw
 * `logoUrl` stays in the payload beside this because the settings panel edits
 * that field — handing a form the fallback is how you seed by accident.
 */
async function displayLogoUrlFor(event: {
  logoUrl: string | null;
  organizationId: string;
}): Promise<string | null> {
  if (event.logoUrl?.trim()) return event.logoUrl;
  const org = await prisma.organization.findUnique({
    where: { id: event.organizationId },
    select: { logoUrl: true },
  });
  return eventLogoWithOrgFallback(event.logoUrl, org?.logoUrl);
}

/**
 * Side-effect-free public schedule for SSR / link unfurls.
 * ACTIVE + slug-linkable only; published sessions/items/speakers/sponsors; no attendee PII;
 * does NOT bump slugInviteUseCount.
 */
eventRouter.get(
  "/public/:slug",
  publicRateLimit(),
  asyncHandler(async (req, res) => {
    const payload = await getPublicEventBySlug(String(req.params.slug || ""));
    if (!payload) {
      return res.status(404).json({ error: "Event not found" });
    }
    return res.json(payload);
  }),
);

/** Public: slug only (never raw event CUID). Enforces ACTIVE + slug invite controls. Bumps use count. */
eventRouter.get(
  "/slug/:slug",
  publicRateLimit(),
  asyncHandler(async (req, res) => {
    const raw = String(req.params.slug || "").trim().toLowerCase();
    if (!raw || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw)) {
      return res.status(404).json({ error: "Event not found" });
    }
    const event = await prisma.event.findUnique({
      where: { slug: raw },
      select: {
        ...publicEventSelect,
        slugInviteEnabled: true,
        slugInviteExpiresAt: true,
        slugInviteCapacity: true,
        slugInviteUseCount: true,
      },
    });
    if (!event || !isPubliclyJoinable(event.status) || !isSlugLinkActive(event)) {
      return res.status(404).json({ error: "Event not found" });
    }
    await prisma.event.update({
      where: { id: event.id },
      data: { slugInviteUseCount: { increment: 1 } },
    });
    return res.json({
      id: event.id,
      name: event.name,
      slug: event.slug,
      bannerUrl: event.bannerUrl,
      logoUrl: event.logoUrl,
      displayLogoUrl: eventLogoWithOrgFallback(event.logoUrl, event.organization.logoUrl),
      brandColor: event.brandColor,
      description: event.description,
      timezone: event.timezone,
      startDate: event.startDate,
      endDate: event.endDate,
    });
  }),
);

/** Public: opaque join token (permanent ID link replacement). */
eventRouter.get(
  "/join/:token",
  authRateLimit({ windowMs: 60_000, max: 10 }),
  asyncHandler(async (req, res) => {
    const raw = String(req.params.token || "").trim();
    if (raw.length < 16) {
      return res.status(404).json({ error: "Event not found" });
    }
    const event = await prisma.event.findFirst({
      where: { joinTokenHash: hashToken(raw) },
      select: {
        ...publicEventSelect,
        joinTokenHash: true,
        joinTokenRevokedAt: true,
        joinTokenExpiresAt: true,
        joinTokenCapacity: true,
        joinTokenUseCount: true,
      },
    });
    if (!event || !isPubliclyJoinable(event.status) || !isJoinLinkActive(event)) {
      return res.status(404).json({ error: "Event not found" });
    }
    await prisma.event.update({
      where: { id: event.id },
      data: { joinTokenUseCount: { increment: 1 } },
    });
    return res.json({
      id: event.id,
      name: event.name,
      slug: event.slug,
      bannerUrl: event.bannerUrl,
      logoUrl: event.logoUrl,
      displayLogoUrl: eventLogoWithOrgFallback(event.logoUrl, event.organization.logoUrl),
      brandColor: event.brandColor,
      description: event.description,
      timezone: event.timezone,
      startDate: event.startDate,
      endDate: event.endDate,
    });
  }),
);

eventRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id);
    const { can } = await import("../lib/billing");
    const hideBadge = await can(event.organizationId, "hide_powered_by_badge");
    return res.json({
      ...(await withPaymentVisibility(toEventClient(event), event.id)),
      uiStatus: uiEventStatus(event),
      displayLogoUrl: await displayLogoUrlFor(event),
      showPoweredByBadge: !hideBadge,
    });
  }),
);

/**
 * The event switcher's list. Deliberately carries no displayLogoUrl: nothing
 * renders a logo from this list, and resolving one would repeat an org's
 * uploaded data URL once per event in the response.
 */
eventRouter.get(
  "/mine",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const memberships = await prisma.orgMembership.findMany({
      where: { userId: req.user!.id },
      select: { organizationId: true },
    });
    const orgIds = memberships.map((m) => m.organizationId);
    const events = await prisma.event.findMany({
      where: {
        OR: [
          { organizationId: { in: orgIds } },
          { memberships: { some: { userId: req.user!.id, deletedAt: null } } },
        ],
      },
      orderBy: { startDate: "desc" },
    });
    return res.json(events.map((e) => ({ ...toEventClient(e), uiStatus: uiEventStatus(e) })));
  }),
);

eventRouter.post(
  "/",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(validationErrorBody(parsed.error));
    }

    const { assertCanCreateEvent, limit } = await import("../lib/billing");

    let organizationId = parsed.data.organizationId;
    if (organizationId) {
      const { organization } = await requireOrgRole(req.user!.id, organizationId, OrgRole.STAFF);
      // ORG-2 — a closed organization takes no new events. Without this, the
      // last membership row of a closed org would quietly bring it back.
      assertOrgOpen(organization);
    } else {
      let org = await prisma.orgMembership.findFirst({
        where: { userId: req.user!.id, organization: { closedAt: null } },
        orderBy: { createdAt: "asc" },
        include: { organization: true },
      });
      if (!org) {
        const slugBase = `org-${req.user!.id.slice(-8)}`;
        const createdOrg = await prisma.organization.create({
          data: {
            name: `${parsed.data.name} Org`,
            slug: await ensureUniqueOrgSlug(slugBase),
            plan: "FREE",
            eventAllowance: 1,
            memberships: {
              create: { userId: req.user!.id, role: OrgRole.OWNER },
            },
          },
        });
        org = await prisma.orgMembership.findUniqueOrThrow({
          where: { organizationId_userId: { organizationId: createdOrg.id, userId: req.user!.id } },
          include: { organization: true },
        });
      } else {
        await requireOrgRole(req.user!.id, org.organizationId, OrgRole.STAFF);
      }
      organizationId = org.organizationId;
    }

    await assertCanCreateEvent(organizationId!);

    const slugBase = parsed.data.slug?.trim().toLowerCase() || slugifyEventBase(parsed.data.name);
    const slug = await ensureUniqueEventSlug(slugBase);
    const { newJoinToken } = await import("../lib/inviteTokens");
    const { raw: joinRaw, hash: joinHash } = newJoinToken();
    const attendeeLimit = await limit(organizationId!, "attendees");
    const attendeeCap = attendeeLimit == null ? 100000 : attendeeLimit;

    const created = await prisma.event.create({
      data: {
        name: parsed.data.name,
        slug,
        // On create there is nothing to preserve, so absent legitimately means null.
        description: trimmedOrNull(parsed.data.description),
        venueName: trimmedOrNull(parsed.data.venueName),
        venueAddress: trimmedOrNull(parsed.data.venueAddress),
        onlineUrl: trimmedOrNull(parsed.data.onlineUrl),
        brandColor: parsed.data.brandColor ?? null,
        bannerUrl: trimmedOrNull(parsed.data.bannerUrl),
        logoUrl: trimmedOrNull(parsed.data.logoUrl),
        timezone: parsed.data.timezone,
        startDate: new Date(parsed.data.startDate),
        endDate: new Date(parsed.data.endDate),
        status: EventStatus.DRAFT,
        createdById: req.user!.id,
        organizationId: organizationId!,
        attendeeCap,
        joinTokenHash: joinHash,
        memberships: {
          create: { userId: req.user!.id, role: EventMemberRole.ADMIN },
        },
      },
    });

    const base = env.webBaseUrl.replace(/\/$/, "");
    return res.json({
      ...toEventClient(created),
      uiStatus: uiEventStatus(created),
      joinToken: joinRaw,
      slugUrl: `${base}/e/${created.slug}`,
      joinUrl: `${base}/e/join/${joinRaw}`,
    });
  }),
);

eventRouter.put(
  "/",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    // W-6 — organizationId on PUT is not a transfer. Reject it so nothing
    // pretends the event moved.
    if (eventUpdateIncludesOrganizationId(req.body)) {
      return res.status(400).json({ error: EVENT_ORGANIZATION_TRANSFER_ERROR });
    }

    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(validationErrorBody(parsed.error));
    }

    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });

    // PAY-T0: the fee fields only exist behind the feature. A save that omits
    // them (every other settings surface) is untouched by this gate.
    const paymentKeysSent = EVENT_PAYMENT_PATCH_KEYS.filter(
      (key) => parsed.data[key] !== undefined,
    );
    if (paymentKeysSent.length > 0) {
      await requireFeature(event.id, "paid_attendance");
    }

    let slug = event.slug;
    if (parsed.data.slug !== undefined) {
      const next = parsed.data.slug.trim().toLowerCase();
      slug = await ensureUniqueEventSlug(next, event.id);
    }

    await prisma.event.update({
      where: { id: event.id },
      data: {
        name: parsed.data.name,
        slug,
        ...patchFields(parsed.data, EVENT_PATCH_FIELDS),
        // paymentUrl is already validated http(s) or null from paymentUrlField,
        // so it bypasses patchFields' string trimming but keeps its contract.
        ...(parsed.data.paymentUrl === undefined ? {} : { paymentUrl: parsed.data.paymentUrl }),
        timezone: parsed.data.timezone,
        startDate: new Date(parsed.data.startDate),
        endDate: new Date(parsed.data.endDate),
      },
    });

    if (paymentKeysSent.length > 0) {
      const { writeAuditLog } = await import("../lib/ai/audit");
      await writeAuditLog({
        organizationId: event.organizationId,
        eventId: event.id,
        actorUserId: req.user!.id,
        action: "OTHER",
        entityType: "Event",
        entityId: event.id,
        payload: {
          action: "registration_fee_settings_saved",
          fields: paymentKeysSent,
          hasPriceText: Boolean(parsed.data.paymentPriceText),
          hasPaymentUrl: Boolean(parsed.data.paymentUrl),
          hasInstructions: Boolean(parsed.data.paymentInstructions),
        },
      });
    }

    // PART-1 — same patch contract as the nullable text columns: absent =
    // untouched; explicit null or [] clears the list (and NULLs memberships
    // that held a removed label).
    if (parsed.data.participantLabels !== undefined) {
      await saveEventParticipantLabels({
        eventId: event.id,
        labels: parsed.data.participantLabels,
      });
    }

    const fresh = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    return res.json({
      ...(await withPaymentVisibility(toEventClient(fresh), event.id)),
      uiStatus: uiEventStatus(fresh),
    });
  }),
);

const statusSchema = z.object({
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]),
});

eventRouter.post(
  "/publish",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    if (event.status === EventStatus.ARCHIVED) {
      return res.status(400).json({ error: "Unarchive before publishing" });
    }
    // E13.1: publishing the event publishes its draft sessions too, in the
    // same transaction — otherwise an ingested programme stays invisible on
    // the public page while looking complete to the organizer.
    const { publishEventDraftSessions } = await import("../lib/ai/ingest/publish");
    const [updated, publishedSessionCount] = await prisma.$transaction(async (tx) => {
      const ev = await tx.event.update({
        where: { id: event.id },
        data: { status: EventStatus.ACTIVE, activatedAt: event.activatedAt ?? new Date() },
      });
      const count = await publishEventDraftSessions(tx, event.id);
      return [ev, count] as const;
    });
    const { markEventChecklistDone } = await import("../lib/onboarding/checklist");
    await markEventChecklistDone(event.id, "publish").catch(() => undefined);
    return res.json({ ...toEventClient(updated), uiStatus: uiEventStatus(updated), publishedSessionCount });
  }),
);

eventRouter.post(
  "/unpublish",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    if (event.status === EventStatus.ARCHIVED) {
      return res.status(400).json({
        error: "Archived events cannot be unpublished to Draft this way — unarchive first",
      });
    }
    const updated = await prisma.event.update({
      where: { id: event.id },
      data: { status: EventStatus.DRAFT },
    });
    return res.json({ ...toEventClient(updated), uiStatus: uiEventStatus(updated) });
  }),
);

eventRouter.post(
  "/archive",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    const updated = await prisma.event.update({
      where: { id: event.id },
      data: { status: EventStatus.ARCHIVED },
    });
    // O1 — portal tokens do not survive archive.
    await revokePortalAccessForEvent(event.id);
    return res.json({ ...toEventClient(updated), uiStatus: uiEventStatus(updated) });
  }),
);

eventRouter.post(
  "/unarchive",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    const updated = await prisma.event.update({
      where: { id: event.id },
      data: { status: EventStatus.DRAFT },
    });
    return res.json({ ...toEventClient(updated), uiStatus: uiEventStatus(updated) });
  }),
);

eventRouter.patch(
  "/status",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationErrorBody(parsed.error));
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    const updated = await prisma.event.update({
      where: { id: event.id },
      data: {
        status: parsed.data.status as EventStatus,
        ...(parsed.data.status === "ACTIVE" && !event.activatedAt ? { activatedAt: new Date() } : {}),
      },
    });
    if (parsed.data.status === "ARCHIVED") {
      await revokePortalAccessForEvent(event.id);
    }
    return res.json({ ...toEventClient(updated), uiStatus: uiEventStatus(updated) });
  }),
);

const transferOrganizationSchema = z.object({
  organizationId: z.string().min(1),
});

/**
 * ORG-2 — can this event move, and where to?
 *
 * The event settings panel only offers "Move to another organization" when this
 * says yes, so an organizer never types their way into a refusal. The reasons
 * come back either way: a draft that has burned AI credit should be told that,
 * not shown a missing button.
 */
eventRouter.get(
  "/transfer-organization",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    const state = await loadEventTransferState(event.id);

    // Only organizations this person could actually host in, minus the one the
    // event is already in and any that are closed.
    const memberships = await prisma.orgMembership.findMany({
      where: {
        userId: req.user!.id,
        role: { in: [OrgRole.OWNER, OrgRole.ADMIN] },
        organization: { closedAt: null },
      },
      select: { role: true, organization: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });

    return res.json({
      eventId: state.eventId,
      canTransfer: state.canTransfer,
      blockers: state.blockers,
      reasons: describeEventTransferBlockers(state.blockers),
      recommendation: state.canTransfer ? null : EVENT_TRANSFER_RECOMMENDATION,
      currentOrganizationId: state.organizationId,
      targets: memberships
        .filter((m) => m.organization.id !== state.organizationId)
        .map((m) => ({ id: m.organization.id, name: m.organization.name, role: m.role })),
    });
  }),
);

/**
 * ORG-2 — the narrow event transfer J-A was willing to allow.
 *
 * PUT /event still refuses organizationId outright (W-6), because a general
 * transfer would have to rewrite billing, metering and audit history for a live
 * event. This route moves an event only while it is a draft with nothing
 * attached, and then moves every row that denormalizes organizationId in one
 * transaction. Anything else is a 409 that says so and points at the way that
 * does work.
 */
eventRouter.post(
  "/transfer-organization",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = transferOrganizationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(validationErrorBody(parsed.error));
    }

    const event = await resolveEventFromRequest(req);
    // Moving an event changes who hosts and who pays for it, so it takes more
    // than the STAFF role that can edit the agenda.
    const access = await requireEventAccess(req.user!.id, event.id, { manage: true });
    if (!access.orgRole || !orgRoleAtLeast(access.orgRole, OrgRole.ADMIN)) {
      return res.status(403).json({ error: EVENT_TRANSFER_TARGET_ROLE_MESSAGE });
    }

    const targetOrgId = parsed.data.organizationId;
    if (targetOrgId === event.organizationId) {
      return res.status(400).json({ error: EVENT_TRANSFER_SAME_ORG_MESSAGE });
    }

    const { organization: target } = await requireOrgRole(req.user!.id, targetOrgId, OrgRole.ADMIN);
    assertOrgOpen(target);

    const state = await loadEventTransferState(event.id);
    if (!state.canTransfer) {
      return res.status(409).json({
        error: EVENT_TRANSFER_BLOCKED_MESSAGE,
        code: "EVENT_TRANSFER_BLOCKED",
        blockers: state.blockers,
        reasons: describeEventTransferBlockers(state.blockers),
        recommendation: EVENT_TRANSFER_RECOMMENDATION,
      });
    }

    // A draft counts against the destination's allowance the moment it lands
    // (loadOrgBilling counts DRAFT + ACTIVE), so the destination has to have
    // room. Otherwise moving events would be a way around the plan limit.
    const { assertCanCreateEvent } = await import("../lib/billing");
    await assertCanCreateEvent(targetOrgId);

    const result = await moveEventToOrganization({
      eventId: event.id,
      fromOrganizationId: event.organizationId,
      toOrganizationId: targetOrgId,
    });

    const { writeAuditLog } = await import("../lib/ai/audit");
    // Written against the DESTINATION, because that is where the event's audit
    // trail now lives — the move itself rewrote the older rows' organizationId,
    // and this entry is the record of that having happened.
    await writeAuditLog({
      organizationId: targetOrgId,
      eventId: event.id,
      actorUserId: req.user!.id,
      action: "OTHER",
      entityType: "Event",
      entityId: event.id,
      payload: {
        action: "event_organization_transferred",
        fromOrganizationId: result.fromOrganizationId,
        toOrganizationId: result.toOrganizationId,
        movedRows: result.movedRows,
      },
    });

    return res.json({
      ok: true,
      eventId: event.id,
      organizationId: targetOrgId,
      movedRows: result.movedRows,
      message: `${event.name} now belongs to ${target.name}.`,
    });
  }),
);

const inviteLinkSchema = z.object({
  joinTokenExpiresAt: z.string().datetime().nullable().optional(),
  joinTokenCapacity: z.number().int().positive().nullable().optional(),
  slugInviteEnabled: z.boolean().optional(),
  slugInviteExpiresAt: z.string().datetime().nullable().optional(),
  slugInviteCapacity: z.number().int().positive().nullable().optional(),
});

eventRouter.get(
  "/invite-links",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });

    const minted = await ensureEventJoinToken(event.id);
    const fresh = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    const base = env.webBaseUrl.replace(/\/$/, "");

    return res.json({
      slug: fresh.slug,
      slugUrl: `${base}/e/${fresh.slug}`,
      slugInviteEnabled: fresh.slugInviteEnabled,
      slugInviteExpiresAt: fresh.slugInviteExpiresAt,
      slugInviteCapacity: fresh.slugInviteCapacity,
      slugInviteUseCount: fresh.slugInviteUseCount,
      joinToken: minted.raw,
      joinUrl: minted.raw ? `${base}/e/join/${minted.raw}` : null,
      joinTokenExpiresAt: fresh.joinTokenExpiresAt,
      joinTokenCapacity: fresh.joinTokenCapacity,
      joinTokenUseCount: fresh.joinTokenUseCount,
      joinTokenRevokedAt: fresh.joinTokenRevokedAt,
      status: fresh.status,
      publiclyReachable: isPubliclyJoinable(fresh.status),
      note: minted.created
        ? "A new permanent join token was minted. Copy it now — it is shown only once."
        : "Permanent join token raw value is only shown when regenerated.",
    });
  }),
);

eventRouter.patch(
  "/invite-links",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = inviteLinkSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(validationErrorBody(parsed.error));
    }
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });

    const updated = await prisma.event.update({
      where: { id: event.id },
      data: {
        ...(parsed.data.joinTokenExpiresAt !== undefined
          ? { joinTokenExpiresAt: parsed.data.joinTokenExpiresAt ? new Date(parsed.data.joinTokenExpiresAt) : null }
          : {}),
        ...(parsed.data.joinTokenCapacity !== undefined ? { joinTokenCapacity: parsed.data.joinTokenCapacity } : {}),
        ...(parsed.data.slugInviteEnabled !== undefined ? { slugInviteEnabled: parsed.data.slugInviteEnabled } : {}),
        ...(parsed.data.slugInviteExpiresAt !== undefined
          ? { slugInviteExpiresAt: parsed.data.slugInviteExpiresAt ? new Date(parsed.data.slugInviteExpiresAt) : null }
          : {}),
        ...(parsed.data.slugInviteCapacity !== undefined ? { slugInviteCapacity: parsed.data.slugInviteCapacity } : {}),
      },
    });
    return res.json(updated);
  }),
);

eventRouter.post(
  "/invite-links/revoke-join",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    await prisma.event.update({
      where: { id: event.id },
      data: { joinTokenRevokedAt: new Date() },
    });
    return res.json({ ok: true });
  }),
);

eventRouter.post(
  "/invite-links/regenerate-join",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    const raw = await regenerateJoinToken(event.id);
    const base = env.webBaseUrl.replace(/\/$/, "");
    return res.json({ ok: true, joinToken: raw, joinUrl: `${base}/e/join/${raw}` });
  }),
);

eventRouter.post(
  "/invite-links/revoke-slug",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    await prisma.event.update({
      where: { id: event.id },
      data: { slugInviteEnabled: false },
    });
    return res.json({ ok: true });
  }),
);

const regenerateSlugSchema = z.object({
  slug: slugField,
});

eventRouter.post(
  "/invite-links/regenerate-slug",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = regenerateSlugSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(validationErrorBody(parsed.error));
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    const slug = await regenerateSlug(event.id, parsed.data.slug);
    const base = env.webBaseUrl.replace(/\/$/, "");
    return res.json({ ok: true, slug, slugUrl: `${base}/e/${slug}` });
  }),
);

const featuresPutSchema = z.object({
  overrides: z.record(z.union([z.boolean(), z.enum(["daily", "weekly", "interrupts_only"])])).optional(),
  preset: z.enum(["everything", "focused", "academic", "pd_day", "talk_showcase"]).optional(),
});

eventRouter.get(
  "/features",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id);
    const {
      loadFeatureOverrides,
      buildFeatureState,
      FEATURE_PRESETS,
    } = await import("../lib/features");
    const overrides = await loadFeatureOverrides(event.id);
    const features = await buildFeatureState(overrides, event.organizationId);
    return res.json({
      eventId: event.id,
      overrides,
      features,
      presets: FEATURE_PRESETS.map((p) => ({
        id: p.id,
        name: p.name,
        plainDescription: p.plainDescription,
      })),
    });
  }),
);

eventRouter.put(
  "/features",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = featuresPutSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationErrorBody(parsed.error));
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });

    const {
      loadFeatureOverrides,
      applyPreset,
      upsertFeatureOverrides,
      buildFeatureState,
      mergeOverrides,
    } = await import("../lib/features");

    let next = await loadFeatureOverrides(event.id);
    if (parsed.data.preset) {
      next = mergeOverrides(next, applyPreset(parsed.data.preset));
    }
    if (parsed.data.overrides) {
      next = mergeOverrides(next, parsed.data.overrides as Record<string, boolean | "daily" | "weekly" | "interrupts_only">);
    }

    const { overrides, forcedOff } = await upsertFeatureOverrides(event.id, next);
    const features = await buildFeatureState(overrides, event.organizationId);
    return res.json({
      eventId: event.id,
      overrides,
      features,
      forcedOff,
      note: "Turning a feature off never deletes existing posts, messages, or Q&A — they stay hidden and return if you turn it back on.",
    });
  }),
);

async function ensureUniqueOrgSlug(base: string): Promise<string> {
  let candidate = base.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-") || "org";
  let n = 0;
  while (await prisma.organization.findUnique({ where: { slug: candidate } })) {
    n += 1;
    candidate = `${base}-${n}`;
  }
  return candidate;
}
