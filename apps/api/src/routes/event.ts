import { EventMemberRole, OrgRole } from "@prisma/client";
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
  bannerUrl: z.string().max(12_000_000).optional(),
  logoUrl: z.string().max(12_000_000).optional(),
  timezone: z.string().min(1),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
});

const publicEventSelect = {
  id: true,
  name: true,
  slug: true,
  bannerUrl: true,
  timezone: true,
  startDate: true,
  endDate: true,
} as const;

/** Public: slug only (never raw event CUID). Enforces slug invite controls. */
eventRouter.get(
  "/slug/:slug",
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
    if (!event || !isSlugLinkActive(event)) {
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
      timezone: event.timezone,
      startDate: event.startDate,
      endDate: event.endDate,
    });
  }),
);

/** Public: opaque join token (permanent ID link replacement). */
eventRouter.get(
  "/join/:token",
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
    if (!event || !isJoinLinkActive(event)) {
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
    return res.json(event);
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
          { memberships: { some: { userId: req.user!.id, role: EventMemberRole.ADMIN } } },
        ],
      },
      orderBy: { startDate: "desc" },
    });
    return res.json(events);
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

    let org = await prisma.orgMembership.findFirst({
      where: { userId: req.user!.id },
      orderBy: { createdAt: "asc" },
      include: { organization: true },
    });
    if (!org) {
      // Bootstrap: create personal org for first-time organizer
      const slugBase = `org-${req.user!.id.slice(-8)}`;
      const createdOrg = await prisma.organization.create({
        data: {
          name: `${parsed.data.name} Org`,
          slug: await ensureUniqueOrgSlug(slugBase),
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

    const slugBase = parsed.data.slug?.trim().toLowerCase() || slugifyEventBase(parsed.data.name);
    const slug = await ensureUniqueEventSlug(slugBase);
    const { raw: joinRaw, hash: joinHash } = await (async () => {
      const { newJoinToken } = await import("../lib/inviteTokens");
      return newJoinToken();
    })();

    const created = await prisma.event.create({
      data: {
        name: parsed.data.name,
        slug,
        bannerUrl: parsed.data.bannerUrl?.trim() || null,
        logoUrl: parsed.data.logoUrl?.trim() || null,
        timezone: parsed.data.timezone,
        startDate: new Date(parsed.data.startDate),
        endDate: new Date(parsed.data.endDate),
        createdById: req.user!.id,
        organizationId: org.organizationId,
        joinTokenHash: joinHash,
        memberships: {
          create: { userId: req.user!.id, role: EventMemberRole.ADMIN },
        },
      },
    });

    return res.json({ ...created, joinToken: joinRaw });
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
        bannerUrl: parsed.data.bannerUrl?.trim() || null,
        logoUrl: parsed.data.logoUrl?.trim() || null,
        timezone: parsed.data.timezone,
        startDate: new Date(parsed.data.startDate),
        endDate: new Date(parsed.data.endDate),
      },
    });

    return res.json(updated);
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

async function ensureUniqueOrgSlug(base: string): Promise<string> {
  let candidate = base.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-") || "org";
  let n = 0;
  while (await prisma.organization.findUnique({ where: { slug: candidate } })) {
    n += 1;
    candidate = `${base}-${n}`;
  }
  return candidate;
}
