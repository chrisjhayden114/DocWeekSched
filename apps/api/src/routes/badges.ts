/**
 * Phase P4 — Badge template + PDF print.
 */

import { Router } from "express";
import { z } from "zod";
import { BadgeSheetSize, EventMemberRole } from "@prisma/client";
import { asyncHandler, HttpError, requireEventAccess } from "../lib/authorization";
import { prisma } from "../lib/db";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";
import { can, upgradePayload } from "../lib/billing/entitlements";
import { longestName, renderBadgePdf, type BadgeAttendee } from "../lib/badges";

export const badgesRouter = Router();

const sheetSizeSchema = z.nativeEnum(BadgeSheetSize);

const templateBodySchema = z.object({
  sheetSize: sheetSizeSchema.optional(),
  showLogo: z.boolean().optional(),
  showName: z.boolean().optional(),
  showAffiliation: z.boolean().optional(),
  showRole: z.boolean().optional(),
  showQr: z.boolean().optional(),
  showBrandColorBar: z.boolean().optional(),
});

async function assertBadgesEntitlement(organizationId: string): Promise<void> {
  if (!(await can(organizationId, "badges"))) {
    throw new HttpError(402, {
      error: "Badge printing requires a Per-event or Pro plan",
      upgrade: upgradePayload({
        code: "FEATURE_LOCKED",
        message: "Upgrade to unlock badge templates and roster PDF print.",
      }),
    });
  }
}

badgesRouter.get(
  "/event/:eventId/template",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const access = await requireEventAccess(req.user!.id, req.params.eventId, { manage: true });
    await assertBadgesEntitlement(access.event.organizationId);

    let template = await prisma.badgeTemplate.findUnique({ where: { eventId: access.event.id } });
    if (!template) {
      template = await prisma.badgeTemplate.create({
        data: {
          organizationId: access.event.organizationId,
          eventId: access.event.id,
        },
      });
    }
    return res.json({ template });
  }),
);

badgesRouter.put(
  "/event/:eventId/template",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const access = await requireEventAccess(req.user!.id, req.params.eventId, { manage: true });
    await assertBadgesEntitlement(access.event.organizationId);

    const parsed = templateBodySchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, { error: "Invalid badge template", details: parsed.error.flatten() });

    const template = await prisma.badgeTemplate.upsert({
      where: { eventId: access.event.id },
      create: {
        organizationId: access.event.organizationId,
        eventId: access.event.id,
        ...parsed.data,
      },
      update: parsed.data,
    });
    return res.json({ template });
  }),
);

badgesRouter.get(
  "/event/:eventId/preview-name",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const access = await requireEventAccess(req.user!.id, req.params.eventId, { manage: true });
    await assertBadgesEntitlement(access.event.organizationId);

    const members = await prisma.eventMembership.findMany({
      where: { eventId: access.event.id, deletedAt: null },
      select: { user: { select: { name: true } } },
    });
    const name = longestName(members.map((m) => m.user.name));
    return res.json({ name: name || "Preview Attendee" });
  }),
);

const pdfQuerySchema = z.object({
  userId: z.string().optional(),
  role: z.nativeEnum(EventMemberRole).optional(),
  /** checked_in | not_checked_in | all */
  status: z.enum(["checked_in", "not_checked_in", "all"]).optional().default("all"),
});

badgesRouter.post(
  "/event/:eventId/pdf",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const access = await requireEventAccess(req.user!.id, req.params.eventId, { manage: true });
    await assertBadgesEntitlement(access.event.organizationId);

    const parsed = pdfQuerySchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new HttpError(400, { error: "Invalid PDF options", details: parsed.error.flatten() });

    let template = await prisma.badgeTemplate.findUnique({ where: { eventId: access.event.id } });
    if (!template) {
      template = await prisma.badgeTemplate.create({
        data: {
          organizationId: access.event.organizationId,
          eventId: access.event.id,
        },
      });
    }

    const members = await prisma.eventMembership.findMany({
      where: {
        eventId: access.event.id,
        deletedAt: null,
        ...(parsed.data.userId ? { userId: parsed.data.userId } : {}),
        ...(parsed.data.role ? { role: parsed.data.role } : {}),
      },
      select: {
        userId: true,
        checkInCode: true,
        role: true,
        user: { select: { name: true, affiliation: true } },
      },
      orderBy: { user: { name: "asc" } },
    });

    let attendees: BadgeAttendee[] = members.map((m) => ({
      userId: m.userId,
      name: m.user.name,
      affiliation: m.user.affiliation,
      role: m.role,
      checkInCode: m.checkInCode,
    }));

    if (parsed.data.status !== "all") {
      const checkIns = await prisma.checkIn.findMany({
        where: { eventId: access.event.id },
        select: { userId: true },
      });
      const checked = new Set(checkIns.map((c) => c.userId));
      attendees = attendees.filter((a) =>
        parsed.data.status === "checked_in" ? checked.has(a.userId) : !checked.has(a.userId),
      );
    }

    const pdf = await renderBadgePdf({
      template,
      eventName: access.event.name,
      brandColor: access.event.brandColor,
      attendees,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="badges-${access.event.slug || access.event.id}.pdf"`,
    );
    return res.send(pdf);
  }),
);
