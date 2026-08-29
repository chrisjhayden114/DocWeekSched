/**
 * SPX-0 / SPX-1 — sponsor outreach pipeline + composer.
 * UKEDL never sends these emails.
 */

import { Router } from "express";
import { z } from "zod";
import {
  dryRunOutreachCsv,
  lastContactedAtForStatusChange,
  normalizeOrgName,
  normalizeWebsiteUrl,
  orgNameKey,
  SPONSOR_PROSPECT_STATUSES,
  type SponsorProspectStatus,
} from "@event-app/shared";
import { asyncHandler, HttpError, requireEventAccess } from "../lib/authorization";
import { prisma } from "../lib/db";
import { resolveEventFromRequest } from "../lib/requestEvent";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";
import { requireFeature } from "../lib/features";
import { assertOutreachProspectCap } from "../lib/billing/entitlements";
import { patchFields, trimmedOrNull } from "../lib/patchFields";
import { validationErrorBody } from "../lib/errors";
import { AUTHENTICATED_AI_CHAT_LIMIT, authRateLimit, testUnlimitedMax } from "../lib/rateLimit";
import { draftOutreachEmail } from "../lib/ai/outreach/draft";

export const outreachRouter = Router();

const statusSchema = z.enum(SPONSOR_PROSPECT_STATUSES);

const optionalEmail = z.string().email().max(320).optional().nullable().or(z.literal(""));
const optionalText = (max: number) => z.string().max(max).optional().nullable();

const createSchema = z.object({
  orgName: z.string().min(1).max(200),
  contactName: optionalText(200),
  contactEmail: optionalEmail,
  websiteUrl: z.string().max(2000).optional().nullable().or(z.literal("")),
  notes: optionalText(4000),
  status: statusSchema.optional(),
});

const patchSchema = createSchema.partial();

const importDryRunSchema = z.object({
  headers: z.array(z.string()).min(1),
  rows: z.array(z.record(z.string())).max(500),
  mapping: z
    .record(z.enum(["org", "contactName", "email", "website", "notes", "skip"]))
    .optional(),
});

const importRowSchema = z.object({
  orgName: z.string().min(1).max(200),
  contactName: optionalText(200),
  contactEmail: optionalEmail,
  websiteUrl: z.string().max(2000).optional().nullable().or(z.literal("")),
  notes: optionalText(4000),
});

const importSchema = z.object({
  prospects: z.array(importRowSchema).min(1).max(200),
});

const templateSchema = z.object({
  name: z.string().min(1).max(120),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(20_000),
});

const templatePatchSchema = templateSchema.partial();

function parseWebsite(value: string | null | undefined): string | null {
  if (value == null) return null;
  const parsed = normalizeWebsiteUrl(value);
  if (!parsed.ok) throw new HttpError(400, { error: parsed.error, code: "VALIDATION" });
  return parsed.url || null;
}

async function requireOutreach(req: AuthedRequest, manage = false) {
  const event = await resolveEventFromRequest(req);
  await requireEventAccess(req.user!.id, event.id, { manage });
  await requireFeature(event.id, "sponsor_outreach");
  return event;
}

async function loadProspect(eventId: string, prospectId: string) {
  const row = await prisma.sponsorProspect.findFirst({
    where: { id: prospectId, eventId },
  });
  if (!row) throw new HttpError(404, { error: "Prospect not found" });
  return row;
}

async function loadTemplate(eventId: string, templateId: string) {
  const row = await prisma.outreachTemplate.findFirst({
    where: { id: templateId, eventId },
  });
  if (!row) throw new HttpError(404, { error: "Template not found" });
  return row;
}

async function orgNameTaken(eventId: string, orgName: string, exceptId?: string): Promise<boolean> {
  const key = orgNameKey(orgName);
  const rows = await prisma.sponsorProspect.findMany({
    where: { eventId, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { orgName: true },
  });
  return rows.some((r) => orgNameKey(r.orgName) === key);
}

outreachRouter.get(
  "/prospects",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await requireOutreach(req, true);
    const prospects = await prisma.sponsorProspect.findMany({
      where: { eventId: event.id },
      orderBy: [{ status: "asc" }, { orgName: "asc" }],
    });
    return res.json(prospects);
  }),
);

outreachRouter.post(
  "/prospects",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationErrorBody(parsed.error));
    const event = await requireOutreach(req, true);
    const orgName = normalizeOrgName(parsed.data.orgName);
    if (!orgName) return res.status(400).json({ error: "Organization name is required", code: "VALIDATION" });
    if (await orgNameTaken(event.id, orgName)) {
      return res.status(409).json({ error: `${orgName} is already in this pipeline` });
    }
    await assertOutreachProspectCap(event.id, event.organizationId, 1);

    const status = parsed.data.status ?? "TO_CONTACT";
    const row = await prisma.sponsorProspect.create({
      data: {
        eventId: event.id,
        orgName,
        contactName: trimmedOrNull(parsed.data.contactName),
        contactEmail: trimmedOrNull(parsed.data.contactEmail),
        websiteUrl: parseWebsite(parsed.data.websiteUrl),
        notes: trimmedOrNull(parsed.data.notes),
        status,
        lastContactedAt: lastContactedAtForStatusChange("TO_CONTACT", status, new Date()) ?? undefined,
      },
    });
    return res.status(201).json(row);
  }),
);

outreachRouter.patch(
  "/prospects/:prospectId",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationErrorBody(parsed.error));
    const event = await requireOutreach(req, true);
    const existing = await loadProspect(event.id, req.params.prospectId);

    let orgName: string | undefined;
    if (parsed.data.orgName !== undefined) {
      orgName = normalizeOrgName(parsed.data.orgName);
      if (!orgName) return res.status(400).json({ error: "Organization name is required", code: "VALIDATION" });
      if (await orgNameTaken(event.id, orgName, existing.id)) {
        return res.status(409).json({ error: `${orgName} is already in this pipeline` });
      }
    }

    let websitePatch: { websiteUrl?: string | null } = {};
    if (parsed.data.websiteUrl !== undefined) {
      websitePatch = { websiteUrl: parseWebsite(parsed.data.websiteUrl) };
    }

    const nextStatus = parsed.data.status;
    const stamped =
      nextStatus !== undefined
        ? lastContactedAtForStatusChange(existing.status, nextStatus, new Date())
        : undefined;

    const row = await prisma.sponsorProspect.update({
      where: { id: existing.id },
      data: {
        ...(orgName !== undefined ? { orgName } : {}),
        ...patchFields(parsed.data, ["contactName", "contactEmail", "notes"]),
        ...websitePatch,
        ...(nextStatus !== undefined ? { status: nextStatus } : {}),
        ...(stamped ? { lastContactedAt: stamped } : {}),
      },
    });
    return res.json(row);
  }),
);

outreachRouter.delete(
  "/prospects/:prospectId",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await requireOutreach(req, true);
    const existing = await loadProspect(event.id, req.params.prospectId);
    await prisma.sponsorProspect.delete({ where: { id: existing.id } });
    return res.json({ ok: true });
  }),
);

outreachRouter.post(
  "/prospects/import-dry-run",
  requireAuth,
  requireCsrf,
  authRateLimit({ windowMs: 60_000, max: 10, keyBy: "user" }),
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = importDryRunSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationErrorBody(parsed.error));
    const event = await requireOutreach(req, true);
    const existing = await prisma.sponsorProspect.findMany({
      where: { eventId: event.id },
      select: { orgName: true },
    });
    return res.json(
      dryRunOutreachCsv({
        headers: parsed.data.headers,
        rows: parsed.data.rows,
        mapping: parsed.data.mapping,
        existingOrgNames: existing.map((r) => r.orgName),
      }),
    );
  }),
);

outreachRouter.post(
  "/prospects/import",
  requireAuth,
  requireCsrf,
  authRateLimit({ windowMs: 60_000, max: 10, keyBy: "user" }),
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationErrorBody(parsed.error));
    const event = await requireOutreach(req, true);

    const seen = new Set<string>();
    const unique: z.infer<typeof importRowSchema>[] = [];
    for (const row of parsed.data.prospects) {
      const key = orgNameKey(row.orgName);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      unique.push({ ...row, orgName: normalizeOrgName(row.orgName) });
    }

    const existing = await prisma.sponsorProspect.findMany({
      where: { eventId: event.id },
      select: { orgName: true },
    });
    const existingKeys = new Set(existing.map((r) => orgNameKey(r.orgName)));

    const toCreate = unique.filter((row) => !existingKeys.has(orgNameKey(row.orgName)));
    const skipped = unique
      .filter((row) => existingKeys.has(orgNameKey(row.orgName)))
      .map((row) => ({ orgName: row.orgName, reason: "Already in this pipeline" }));

    await assertOutreachProspectCap(event.id, event.organizationId, toCreate.length);

    const created = [];
    for (const row of toCreate) {
      created.push(
        await prisma.sponsorProspect.create({
          data: {
            eventId: event.id,
            orgName: row.orgName,
            contactName: trimmedOrNull(row.contactName),
            contactEmail: trimmedOrNull(row.contactEmail),
            websiteUrl: parseWebsite(row.websiteUrl),
            notes: trimmedOrNull(row.notes),
          },
        }),
      );
    }

    return res.json({
      ok: true,
      createdCount: created.length,
      skippedCount: skipped.length,
      created,
      skipped,
    });
  }),
);

outreachRouter.post(
  "/prospects/:prospectId/add-as-sponsor",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await requireOutreach(req, true);
    await requireFeature(event.id, "sponsors");
    const prospect = await loadProspect(event.id, req.params.prospectId);

    if (prospect.sponsorId) {
      const linked = await prisma.sponsor.findFirst({
        where: { id: prospect.sponsorId, eventId: event.id },
      });
      if (linked) return res.json({ prospect, sponsor: linked, created: false });
    }

    const nameKey = orgNameKey(prospect.orgName);
    const already = await prisma.sponsor.findMany({
      where: { eventId: event.id },
      select: { id: true, name: true },
    });
    const match = already.find((s) => orgNameKey(s.name) === nameKey);
    const sponsor =
      match != null
        ? await prisma.sponsor.findUniqueOrThrow({ where: { id: match.id } })
        : await prisma.sponsor.create({
            data: {
              eventId: event.id,
              name: prospect.orgName,
              url: prospect.websiteUrl,
              tier: "Standard",
            },
          });

    const updated = await prisma.sponsorProspect.update({
      where: { id: prospect.id },
      data: { sponsorId: sponsor.id },
    });
    return res.json({ prospect: updated, sponsor, created: match == null });
  }),
);

outreachRouter.get(
  "/templates",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await requireOutreach(req, true);
    const templates = await prisma.outreachTemplate.findMany({
      where: { eventId: event.id },
      orderBy: [{ name: "asc" }, { createdAt: "asc" }],
    });
    return res.json(templates);
  }),
);

outreachRouter.post(
  "/templates",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = templateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationErrorBody(parsed.error));
    const event = await requireOutreach(req, true);
    const row = await prisma.outreachTemplate.create({
      data: {
        eventId: event.id,
        name: parsed.data.name.trim(),
        subject: parsed.data.subject.trim(),
        body: parsed.data.body,
      },
    });
    return res.status(201).json(row);
  }),
);

outreachRouter.patch(
  "/templates/:templateId",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = templatePatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationErrorBody(parsed.error));
    const event = await requireOutreach(req, true);
    const existing = await loadTemplate(event.id, req.params.templateId);
    const row = await prisma.outreachTemplate.update({
      where: { id: existing.id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
        ...(parsed.data.subject !== undefined ? { subject: parsed.data.subject.trim() } : {}),
        ...(parsed.data.body !== undefined ? { body: parsed.data.body } : {}),
      },
    });
    return res.json(row);
  }),
);

outreachRouter.delete(
  "/templates/:templateId",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await requireOutreach(req, true);
    const existing = await loadTemplate(event.id, req.params.templateId);
    await prisma.outreachTemplate.delete({ where: { id: existing.id } });
    return res.json({ ok: true });
  }),
);

outreachRouter.post(
  "/prospects/:prospectId/draft",
  requireAuth,
  requireCsrf,
  authRateLimit({
    ...AUTHENTICATED_AI_CHAT_LIMIT,
    max: testUnlimitedMax(AUTHENTICATED_AI_CHAT_LIMIT.max),
  }),
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await requireOutreach(req, true);
    const prospect = await loadProspect(event.id, req.params.prospectId);
    const result = await draftOutreachEmail({
      organizationId: event.organizationId,
      eventId: event.id,
      userId: req.user!.id,
      event: {
        name: event.name,
        slug: event.slug,
        description: event.description,
        timezone: event.timezone,
        startDate: event.startDate,
        endDate: event.endDate,
        attendeeCap: event.attendeeCap,
        participantLabelsJson: event.participantLabelsJson,
      },
      prospect: {
        orgName: prospect.orgName,
        contactName: prospect.contactName,
        contactEmail: prospect.contactEmail,
        websiteUrl: prospect.websiteUrl,
        notes: prospect.notes,
      },
    });
    if (!result.ok) {
      if (result.code === "CAP_EXCEEDED") {
        return res.status(402).json({
          error: result.message,
          code: "CAP_EXCEEDED",
          upgrade: result.upgrade,
        });
      }
      return res.status(502).json({ error: result.message || "Could not draft this email", code: result.code });
    }
    return res.json(result.draft);
  }),
);
