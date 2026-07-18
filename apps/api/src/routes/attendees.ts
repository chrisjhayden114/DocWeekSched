import { EventMemberRole, NotificationKind, OrgRole } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { hashPassword } from "../lib/auth";
import { asyncHandler, HttpError, requireEventAccess } from "../lib/authorization";
import { prisma } from "../lib/db";
import { env } from "../lib/env";
import { newInviteToken, ensureEventJoinToken, isSlugLinkActive } from "../lib/inviteTokens";
import { sendParticipantInviteEmail } from "../lib/mail";
import { notifyMany } from "../lib/notifications";
import { resolveEventFromRequest } from "../lib/requestEvent";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";
import { randomBytes } from "crypto";

export const attendeesRouter = Router();

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  photoUrl: z.string().max(12_000_000).optional(),
  researchInterests: z.string().max(4000).optional(),
});

const inviteBulkSchema = z.object({
  invites: z.array(inviteSchema).min(1).max(200),
});

const attendeePublicSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  photoUrl: true,
  researchInterests: true,
  participantType: true,
} as const;

type InviteInput = z.infer<typeof inviteSchema>;

async function createAndEmailInvite(
  event: { id: string; slug: string; name: string },
  data: InviteInput,
): Promise<
  | { ok: true; inviteUrl: string; emailDelivered: boolean; emailFallbackMessage?: string }
  | { ok: false; error: string }
> {
  const email = data.email.trim().toLowerCase();
  const name = data.name.trim();
  const existing = await prisma.user.findUnique({ where: { email } });

  const { raw, hash, expiresAt } = newInviteToken();
  const base = env.webBaseUrl.replace(/\/$/, "");

  let userId: string;
  if (existing) {
    const already = await prisma.eventMembership.findUnique({
      where: { eventId_userId: { eventId: event.id, userId: existing.id } },
    });
    if (already && !existing.profileSetupTokenHash) {
      return { ok: false, error: "This person is already on the event roster" };
    }
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        profileSetupTokenHash: hash,
        profileSetupTokenExpiresAt: expiresAt,
        ...(data.photoUrl?.trim() ? { photoUrl: data.photoUrl.trim() } : {}),
        ...(data.researchInterests?.trim() ? { researchInterests: data.researchInterests.trim() } : {}),
      },
    });
    userId = existing.id;
  } else {
    const passwordHash = await hashPassword(randomBytes(24).toString("hex"));
    const created = await prisma.user.create({
      data: {
        email,
        name,
        photoUrl: data.photoUrl?.trim() || null,
        researchInterests: data.researchInterests?.trim() || null,
        role: "ATTENDEE",
        passwordHash,
        profileSetupTokenHash: hash,
        profileSetupTokenExpiresAt: expiresAt,
        emailVerifiedAt: null,
      },
    });
    userId = created.id;
  }

  await prisma.eventMembership.upsert({
    where: { eventId_userId: { eventId: event.id, userId } },
    create: { eventId: event.id, userId, role: EventMemberRole.ATTENDEE },
    update: { deletedAt: null, role: EventMemberRole.ATTENDEE },
  });

  const minted = await ensureEventJoinToken(event.id);
  const joinPath = minted.raw
    ? `${base}/e/join/${minted.raw}`
    : isSlugLinkActive(await prisma.event.findUniqueOrThrow({ where: { id: event.id } }))
      ? `${base}/e/${event.slug}`
      : `${base}/e/${event.slug}`;

  const inviteUrl = `${base}/invite/${raw}?event=${encodeURIComponent(event.id)}`;

  const mailResult = await sendParticipantInviteEmail({
    to: email,
    name,
    eventName: event.name,
    inviteUrl,
    permanentEventUrl: joinPath,
    expiresInDays: env.inviteTokenDays,
  });

  return {
    ok: true,
    inviteUrl,
    emailDelivered: mailResult.delivered,
    emailFallbackMessage: mailResult.fallbackMessage,
  };
}

attendeesRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    const access = await requireEventAccess(req.user!.id, event.id);

    const members = await prisma.eventMembership.findMany({
      where: { eventId: event.id, deletedAt: null },
      include: {
        user: {
          select: {
            ...attendeePublicSelect,
            profileSetupTokenHash: true,
            profileSetupTokenExpiresAt: true,
          },
        },
      },
      orderBy: { user: { name: "asc" } },
    });

    if (!access.canManageEvent) {
      return res.json(
        members.map((m) => ({
          id: m.user.id,
          name: m.user.name,
          email: m.user.email,
          role: m.user.role,
          photoUrl: m.user.photoUrl,
          researchInterests: m.user.researchInterests,
          participantType: m.user.participantType,
          eventRole: m.role,
        })),
      );
    }

    return res.json(
      members.map((m) => {
        const u = m.user;
        const pending = u.profileSetupTokenHash != null;
        const expiresAt = u.profileSetupTokenExpiresAt;
        const expired = pending && expiresAt != null && expiresAt.getTime() < Date.now();
        const inviteStatus = !pending ? "ACTIVE" : expired ? "INVITE_EXPIRED" : "PENDING_SETUP";
        return {
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          photoUrl: u.photoUrl,
          researchInterests: u.researchInterests,
          participantType: u.participantType,
          eventRole: m.role,
          inviteStatus,
          inviteExpiresAt: pending && expiresAt ? expiresAt.toISOString() : null,
        };
      }),
    );
  }),
);

attendeesRouter.post(
  "/invite",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = inviteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });

    const result = await createAndEmailInvite(event, parsed.data);
    if (!result.ok) {
      return res.status(409).json({ error: result.error });
    }
    return res.json({
      ok: true,
      inviteUrl: result.inviteUrl,
      emailDelivered: result.emailDelivered,
      emailFallbackMessage: result.emailFallbackMessage,
    });
  }),
);

const dryRunSchema = z.object({
  headers: z.array(z.string()).min(1),
  rows: z.array(z.record(z.string())).max(500),
  mapping: z.record(z.enum(["email", "name", "description", "bio", "photoUrl", "skip"])).optional(),
});

attendeesRouter.post(
  "/invite-dry-run",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = dryRunSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });

    const members = await prisma.eventMembership.findMany({
      where: { eventId: event.id, deletedAt: null },
      include: { user: { select: { email: true } } },
    });
    const existingEmails = members.map((m) => m.user.email);

    const { dryRunCsvInvites } = await import("../lib/csvInviteDryRun");
    const result = dryRunCsvInvites({
      headers: parsed.data.headers,
      rows: parsed.data.rows,
      mapping: parsed.data.mapping,
      existingEmails,
    });
    return res.json(result);
  }),
);

attendeesRouter.post(
  "/invite-bulk",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = inviteBulkSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });

    const seen = new Set<string>();
    const unique: InviteInput[] = [];
    for (const row of parsed.data.invites) {
      const key = row.email.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(row);
    }

    const sent: {
      email: string;
      inviteUrl: string;
      emailDelivered: boolean;
      emailFallbackMessage?: string;
    }[] = [];
    const failed: { email: string; error: string }[] = [];

    for (const inv of unique) {
      const result = await createAndEmailInvite(event, inv);
      if (result.ok) {
        sent.push({
          email: inv.email.trim().toLowerCase(),
          inviteUrl: result.inviteUrl,
          emailDelivered: result.emailDelivered,
          emailFallbackMessage: result.emailFallbackMessage,
        });
      } else {
        failed.push({ email: inv.email.trim().toLowerCase(), error: result.error });
      }
    }

    const anyUndelivered = sent.some((s) => !s.emailDelivered);
    return res.json({
      ok: true,
      sentCount: sent.length,
      failedCount: failed.length,
      sent,
      failed,
      emailFallbackMessage: anyUndelivered
        ? "Email delivery isn't set up — copy this invite link instead"
        : undefined,
    });
  }),
);

attendeesRouter.post(
  "/admin-access-request",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    const access = await requireEventAccess(req.user!.id, event.id);
    if (access.canManageEvent) {
      return res.status(400).json({ error: "You already have organizer access for this event." });
    }

    const me = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, name: true, email: true },
    });
    if (!me) throw new HttpError(404, { error: "User not found" });

    const existingPending = await prisma.adminAccessRequest.findFirst({
      where: { eventId: event.id, userId: me.id, status: "PENDING" },
    });
    if (existingPending) {
      return res.json({ ok: true, alreadyRequested: true });
    }

    await prisma.adminAccessRequest.create({
      data: {
        organizationId: event.organizationId,
        eventId: event.id,
        userId: me.id,
        status: "PENDING",
      },
    });

    const owners = await prisma.orgMembership.findMany({
      where: { organizationId: event.organizationId, role: OrgRole.OWNER },
      select: { userId: true },
    });
    if (owners.length === 0) {
      return res.status(503).json({ error: "No organization owners are available to review this request." });
    }

    const title = "Administrator access requested";
    const body = `${me.name} (${me.email}) requested administrator access for ${event.name}. Only an organization OWNER can grant this.`;

    await notifyMany(
      owners
        .filter((row) => row.userId !== me.id)
        .map((row) => ({
          userId: row.userId,
          eventId: event.id,
          kind: NotificationKind.ADMIN_REQUEST,
          title,
          body,
        })),
    );

    return res.json({ ok: true });
  }),
);

attendeesRouter.get(
  "/admin-access-requests",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    const access = await requireEventAccess(req.user!.id, event.id, { manage: true });

    const requests = await prisma.adminAccessRequest.findMany({
      where: { eventId: event.id, status: "PENDING" },
      include: {
        user: { select: { id: true, name: true, email: true, photoUrl: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    return res.json({
      requests,
      canGrant: access.orgRole === OrgRole.OWNER,
    });
  }),
);

attendeesRouter.post(
  "/admin-access-requests/:requestId/grant",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { ownerOnly: true });

    const request = await prisma.adminAccessRequest.findFirst({
      where: { id: req.params.requestId, eventId: event.id, status: "PENDING" },
    });
    if (!request) throw new HttpError(404, { error: "Request not found" });

    await prisma.$transaction(async (tx) => {
      await tx.adminAccessRequest.update({
        where: { id: request.id },
        data: {
          status: "GRANTED",
          resolvedAt: new Date(),
          resolvedById: req.user!.id,
        },
      });
      await tx.orgMembership.upsert({
        where: {
          organizationId_userId: { organizationId: event.organizationId, userId: request.userId },
        },
        create: {
          organizationId: event.organizationId,
          userId: request.userId,
          role: OrgRole.ADMIN,
        },
        update: { role: OrgRole.ADMIN },
      });
      await tx.eventMembership.upsert({
        where: { eventId_userId: { eventId: event.id, userId: request.userId } },
        create: { eventId: event.id, userId: request.userId, role: EventMemberRole.ADMIN },
        update: { role: EventMemberRole.ADMIN },
      });
      // Keep legacy global role for UI that still checks user.role during transition.
      await tx.user.update({
        where: { id: request.userId },
        data: { role: "ADMIN" },
      });
    });

    return res.json({ ok: true });
  }),
);

attendeesRouter.post(
  "/admin-access-requests/:requestId/deny",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { ownerOnly: true });

    const request = await prisma.adminAccessRequest.findFirst({
      where: { id: req.params.requestId, eventId: event.id, status: "PENDING" },
    });
    if (!request) throw new HttpError(404, { error: "Request not found" });

    await prisma.adminAccessRequest.update({
      where: { id: request.id },
      data: {
        status: "DENIED",
        resolvedAt: new Date(),
        resolvedById: req.user!.id,
      },
    });

    return res.json({ ok: true });
  }),
);

/** Promote event participant to event ADMIN + org ADMIN. OWNER-only. */
attendeesRouter.post(
  "/:id/make-admin",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { ownerOnly: true });

    const targetId = req.params.id;
    const membership = await prisma.eventMembership.findUnique({
      where: { eventId_userId: { eventId: event.id, userId: targetId } },
    });
    if (!membership) throw new HttpError(404, { error: "Participant not found" });

    await prisma.$transaction(async (tx) => {
      await tx.orgMembership.upsert({
        where: {
          organizationId_userId: { organizationId: event.organizationId, userId: targetId },
        },
        create: { organizationId: event.organizationId, userId: targetId, role: OrgRole.ADMIN },
        update: { role: OrgRole.ADMIN },
      });
      await tx.eventMembership.update({
        where: { eventId_userId: { eventId: event.id, userId: targetId } },
        data: { role: EventMemberRole.ADMIN },
      });
      await tx.user.update({ where: { id: targetId }, data: { role: "ADMIN" } });
    });

    return res.json({ ok: true });
  }),
);

attendeesRouter.post(
  "/:id/remove-admin",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { ownerOnly: true });

    const targetId = req.params.id;
    if (targetId === req.user!.id) {
      return res.status(400).json({ error: "You cannot remove your own administrator access here." });
    }

    const orgMem = await prisma.orgMembership.findUnique({
      where: {
        organizationId_userId: { organizationId: event.organizationId, userId: targetId },
      },
    });
    if (orgMem?.role === OrgRole.OWNER) {
      return res.status(400).json({ error: "Cannot demote the organization owner." });
    }

    await prisma.$transaction(async (tx) => {
      if (orgMem) {
        await tx.orgMembership.update({
          where: { id: orgMem.id },
          data: { role: OrgRole.STAFF },
        });
      }
      await tx.eventMembership.updateMany({
        where: { eventId: event.id, userId: targetId },
        data: { role: EventMemberRole.ATTENDEE },
      });
      await tx.user.update({ where: { id: targetId }, data: { role: "ATTENDEE" } });
    });

    return res.json({ ok: true });
  }),
);

attendeesRouter.delete(
  "/:id",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });

    const targetId = req.params.id;
    if (targetId === req.user!.id) {
      return res.status(400).json({ error: "You cannot remove yourself" });
    }

    const membership = await prisma.eventMembership.findUnique({
      where: { eventId_userId: { eventId: event.id, userId: targetId } },
      include: { user: { select: { id: true, role: true } } },
    });
    if (!membership || membership.deletedAt) throw new HttpError(404, { error: "Participant not found" });

    const orgMem = await prisma.orgMembership.findUnique({
      where: {
        organizationId_userId: { organizationId: event.organizationId, userId: targetId },
      },
    });
    if (orgMem && (orgMem.role === OrgRole.OWNER || orgMem.role === OrgRole.ADMIN)) {
      return res.status(403).json({ error: "Org admins cannot be removed from the roster here" });
    }

    await prisma.eventMembership.update({
      where: { eventId_userId: { eventId: event.id, userId: targetId } },
      data: { deletedAt: new Date() },
    });

    return res.json({
      ok: true,
      softDeleted: true,
      message: "Participant removed from the roster. Their data is retained for 30 days.",
    });
  }),
);
