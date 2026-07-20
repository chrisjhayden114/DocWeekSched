import { EventMemberRole, EventStatus, OrgRole } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler, requireEventAccess, requireOrgRole } from "../lib/authorization";
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

export const eventRouter = Router();

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
  brandColor: z.string().max(32).optional().nullable(),
  bannerUrl: z.string().max(12_000_000).optional().nullable(),
  logoUrl: z.string().max(12_000_000).optional().nullable(),
  timezone: z.string().min(1),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  organizationId: z.string().optional(),
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
} as const;

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
      ...event,
      uiStatus: uiEventStatus(event),
      showPoweredByBadge: !hideBadge,
    });
  }),
);

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
          { memberships: { some: { userId: req.user!.id, role: EventMemberRole.ADMIN, deletedAt: null } } },
        ],
      },
      orderBy: { startDate: "desc" },
    });
    return res.json(events.map((e) => ({ ...e, uiStatus: uiEventStatus(e) })));
  }),
);

eventRouter.post(
  "/",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const { assertCanCreateEvent, limit } = await import("../lib/billing");

    let organizationId = parsed.data.organizationId;
    if (organizationId) {
      await requireOrgRole(req.user!.id, organizationId, OrgRole.STAFF);
    } else {
      let org = await prisma.orgMembership.findFirst({
        where: { userId: req.user!.id },
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
        description: parsed.data.description?.trim() || null,
        venueName: parsed.data.venueName?.trim() || null,
        venueAddress: parsed.data.venueAddress?.trim() || null,
        onlineUrl: parsed.data.onlineUrl?.trim() || null,
        brandColor: parsed.data.brandColor?.trim() || null,
        bannerUrl: parsed.data.bannerUrl?.trim() || null,
        logoUrl: parsed.data.logoUrl?.trim() || null,
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
      ...created,
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
    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });

    let slug = event.slug;
    if (parsed.data.slug !== undefined) {
      const next = parsed.data.slug.trim().toLowerCase();
      slug = await ensureUniqueEventSlug(next, event.id);
    }

    const updated = await prisma.event.update({
      where: { id: event.id },
      data: {
        name: parsed.data.name,
        slug,
        description: parsed.data.description?.trim() || null,
        venueName: parsed.data.venueName?.trim() || null,
        venueAddress: parsed.data.venueAddress?.trim() || null,
        onlineUrl: parsed.data.onlineUrl?.trim() || null,
        brandColor: parsed.data.brandColor?.trim() || null,
        bannerUrl: parsed.data.bannerUrl?.trim() || null,
        logoUrl: parsed.data.logoUrl?.trim() || null,
        timezone: parsed.data.timezone,
        startDate: new Date(parsed.data.startDate),
        endDate: new Date(parsed.data.endDate),
      },
    });

    return res.json({ ...updated, uiStatus: uiEventStatus(updated) });
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
    const updated = await prisma.event.update({
      where: { id: event.id },
      data: { status: EventStatus.ACTIVE, activatedAt: event.activatedAt ?? new Date() },
    });
    const { markEventChecklistDone } = await import("../lib/onboarding/checklist");
    await markEventChecklistDone(event.id, "publish").catch(() => undefined);
    return res.json({ ...updated, uiStatus: uiEventStatus(updated) });
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
    return res.json({ ...updated, uiStatus: uiEventStatus(updated) });
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
    return res.json({ ...updated, uiStatus: uiEventStatus(updated) });
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
    return res.json({ ...updated, uiStatus: uiEventStatus(updated) });
  }),
);

eventRouter.patch(
  "/status",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    const updated = await prisma.event.update({
      where: { id: event.id },
      data: {
        status: parsed.data.status as EventStatus,
        ...(parsed.data.status === "ACTIVE" && !event.activatedAt ? { activatedAt: new Date() } : {}),
      },
    });
    return res.json({ ...updated, uiStatus: uiEventStatus(updated) });
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
      return res.status(400).json({ error: parsed.error.flatten() });
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

eventRouter.post(
  "/invite-links/regenerate-slug",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    const preferred = typeof req.body?.slug === "string" ? req.body.slug : undefined;
    const slug = await regenerateSlug(event.id, preferred);
    const base = env.webBaseUrl.replace(/\/$/, "");
    return res.json({ ok: true, slug, slugUrl: `${base}/e/${slug}` });
  }),
);

const featuresPutSchema = z.object({
  overrides: z.record(z.union([z.boolean(), z.enum(["daily", "weekly", "interrupts_only"])])).optional(),
  preset: z.enum(["everything", "focused", "academic"]).optional(),
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
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
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
