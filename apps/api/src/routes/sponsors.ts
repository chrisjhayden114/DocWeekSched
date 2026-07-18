/**
 * Phase 5 — Sponsors + lead capture.
 */

import { Router } from "express";
import { z } from "zod";
import { asyncHandler, HttpError, requireEventAccess } from "../lib/authorization";
import { prisma } from "../lib/db";
import { resolveEventFromRequest } from "../lib/requestEvent";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";
import { requireFeature } from "../lib/features";

export const sponsorsRouter = Router();

sponsorsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id);
    await requireFeature(event.id, "sponsors");

    const sponsors = await prisma.sponsor.findMany({
      where: { eventId: event.id },
      orderBy: [{ sortOrder: "asc" }, { tier: "asc" }, { name: "asc" }],
    });
    return res.json(sponsors);
  }),
);

const sponsorSchema = z.object({
  name: z.string().min(1).max(200),
  logoUrl: z.string().max(2_000_000).optional().nullable(),
  url: z.string().url().max(2000).optional().nullable().or(z.literal("")),
  tier: z.string().min(1).max(100).optional(),
  sortOrder: z.number().int().optional(),
  boothLabel: z.string().max(200).optional().nullable(),
  description: z.string().max(8000).optional().nullable(),
});

sponsorsRouter.post(
  "/",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = sponsorSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    await requireFeature(event.id, "sponsors");

    const row = await prisma.sponsor.create({
      data: {
        eventId: event.id,
        name: parsed.data.name.trim(),
        logoUrl: parsed.data.logoUrl || null,
        url: parsed.data.url || null,
        tier: parsed.data.tier?.trim() || "Standard",
        sortOrder: parsed.data.sortOrder ?? 0,
        boothLabel: parsed.data.boothLabel || null,
        description: parsed.data.description || null,
      },
    });
    return res.status(201).json(row);
  }),
);

sponsorsRouter.put(
  "/:sponsorId",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = sponsorSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    await requireFeature(event.id, "sponsors");

    const existing = await prisma.sponsor.findFirst({
      where: { id: req.params.sponsorId, eventId: event.id },
    });
    if (!existing) throw new HttpError(404, { error: "Sponsor not found" });

    const row = await prisma.sponsor.update({
      where: { id: existing.id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
        ...(parsed.data.logoUrl !== undefined ? { logoUrl: parsed.data.logoUrl || null } : {}),
        ...(parsed.data.url !== undefined ? { url: parsed.data.url || null } : {}),
        ...(parsed.data.tier !== undefined ? { tier: parsed.data.tier.trim() } : {}),
        ...(parsed.data.sortOrder !== undefined ? { sortOrder: parsed.data.sortOrder } : {}),
        ...(parsed.data.boothLabel !== undefined ? { boothLabel: parsed.data.boothLabel || null } : {}),
        ...(parsed.data.description !== undefined ? { description: parsed.data.description || null } : {}),
      },
    });
    return res.json(row);
  }),
);

sponsorsRouter.delete(
  "/:sponsorId",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    await requireFeature(event.id, "sponsors");

    const existing = await prisma.sponsor.findFirst({
      where: { id: req.params.sponsorId, eventId: event.id },
    });
    if (!existing) throw new HttpError(404, { error: "Sponsor not found" });
    await prisma.sponsor.delete({ where: { id: existing.id } });
    return res.json({ ok: true });
  }),
);

const leadSchema = z.object({
  name: z.string().max(200).optional().nullable(),
  email: z.string().email().max(320).optional().nullable().or(z.literal("")),
  company: z.string().max(200).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  attendeeUserId: z.string().optional().nullable(),
});

sponsorsRouter.post(
  "/:sponsorId/leads",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = leadSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id);
    await requireFeature(event.id, "sponsors");

    const sponsor = await prisma.sponsor.findFirst({
      where: { id: req.params.sponsorId, eventId: event.id },
    });
    if (!sponsor) throw new HttpError(404, { error: "Sponsor not found" });

    const lead = await prisma.sponsorLead.create({
      data: {
        sponsorId: sponsor.id,
        capturedByUserId: req.user!.id,
        attendeeUserId: parsed.data.attendeeUserId || null,
        name: parsed.data.name?.trim() || null,
        email: parsed.data.email || null,
        company: parsed.data.company?.trim() || null,
        notes: parsed.data.notes?.trim() || null,
      },
    });
    return res.status(201).json(lead);
  }),
);

sponsorsRouter.get(
  "/:sponsorId/leads.csv",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    await requireFeature(event.id, "sponsors");

    const sponsor = await prisma.sponsor.findFirst({
      where: { id: req.params.sponsorId, eventId: event.id },
    });
    if (!sponsor) throw new HttpError(404, { error: "Sponsor not found" });

    const leads = await prisma.sponsorLead.findMany({
      where: { sponsorId: sponsor.id },
      orderBy: { createdAt: "desc" },
    });

    const header = "name,email,company,notes,attendeeUserId,capturedByUserId,createdAt";
    const lines = leads.map((l) =>
      [l.name, l.email, l.company, l.notes, l.attendeeUserId, l.capturedByUserId, l.createdAt.toISOString()]
        .map((v) => {
          const s = v == null ? "" : String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    );
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="sponsor-${sponsor.id}-leads.csv"`);
    return res.send([header, ...lines].join("\n"));
  }),
);
