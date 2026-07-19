import { EventMemberRole, OrgRole } from "@prisma/client";
import { brand } from "@event-app/config";
import { Router } from "express";
import { z } from "zod";
import {
  assertPasswordAllowed,
  generateOpaqueToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from "../lib/auth";
import { asyncHandler, HttpError, requireEventAccess } from "../lib/authorization";
import { clearSessionCookies, setSessionCookies } from "../lib/cookies";
import { prisma } from "../lib/db";
import { env } from "../lib/env";
import { newInviteToken } from "../lib/inviteTokens";
import { sendPasswordResetEmail, sendEmailVerificationEmail } from "../lib/mail";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";
import { authRateLimit, clearAuthFailures, noteAuthFailure } from "../lib/rateLimit";
import { resolveEventFromRequest, getRequestedEventId } from "../lib/requestEvent";

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
  role: z.enum(["ATTENDEE", "SPEAKER"]).default("ATTENDEE"),
  researchInterests: z.string().optional(),
  participantType: z.enum(["GRAD_STUDENT", "EDD_STUDENT", "PHD_STUDENT", "EDL_ALUMNI", "PROFESSOR"]).optional(),
});

const adminRegisterSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
  inviteCode: z.string().min(1),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
  eventSlug: z.string().min(2).max(96).optional(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(16),
  password: z.string().min(8),
});

const meSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  photoUrl: true,
  researchInterests: true,
  title: true,
  affiliation: true,
  bio: true,
  participantType: true,
  engagementPoints: true,
  emailVerifiedAt: true,
} as const;

const GENERIC_AUTH_ERROR = "Invalid credentials";
const GENERIC_FORGOT = "If that email is in our system, a reset link has been sent.";

function passwordErrorMessage(code: string): string {
  if (code === "PASSWORD_TOO_SHORT") return "Password must be at least 8 characters.";
  if (code === "PASSWORD_BREACHED") return "This password is too common or has appeared in a data breach. Choose another.";
  return "Invalid password.";
}

authRouter.post(
  "/register",
  authRateLimit(),
  asyncHandler(async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    try {
      await assertPasswordAllowed(parsed.data.password);
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      return res.status(400).json({ error: passwordErrorMessage(code) });
    }

    const { email, name, password, role, researchInterests, participantType } = parsed.data;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      // Invited users complete setup via /profile-setup; do not reveal account existence.
      return res.status(409).json({ error: "Unable to register with this email" });
    }

    const passwordHash = await hashPassword(password);
    const verifyRaw = generateOpaqueToken(32);
    const user = await prisma.user.create({
      data: {
        email,
        name,
        role,
        researchInterests,
        participantType,
        passwordHash,
        emailVerifiedAt: null,
        emailVerifyTokenHash: hashToken(verifyRaw),
        emailVerifyTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
      select: meSelect,
    });

    const base = env.webBaseUrl.replace(/\/$/, "");
    const verifyUrl = `${base}/verify-email/${verifyRaw}`;
    await sendEmailVerificationEmail({ to: email, name, verifyUrl });

    // Optionally attach to event if client sent x-event-id (attendee self-register via event link).
    const eventId = getRequestedEventId(req);
    if (eventId) {
      const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
      if (event) {
        const { assertCanAddAttendee } = await import("../lib/billing");
        const existingMembership = await prisma.eventMembership.findUnique({
          where: { eventId_userId: { eventId: event.id, userId: user.id } },
        });
        if (!existingMembership || existingMembership.deletedAt) {
          await assertCanAddAttendee(event.id);
        }
        await prisma.eventMembership.upsert({
          where: { eventId_userId: { eventId: event.id, userId: user.id } },
          create: { eventId: event.id, userId: user.id, role: EventMemberRole.ATTENDEE },
          update: { deletedAt: null },
        });
      }
    }

    return res.status(201).json({
      ok: true,
      requiresEmailVerification: true,
      message: `Check your email to verify your ${brand.productName} account before signing in.`,
    });
  }),
);

authRouter.post(
  "/register-admin",
  authRateLimit(),
  asyncHandler(async (req, res) => {
    const parsed = adminRegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    if (!env.adminInviteCode || parsed.data.inviteCode !== env.adminInviteCode) {
      noteAuthFailure(req);
      return res.status(403).json({ error: "Invalid admin invite code" });
    }

    try {
      await assertPasswordAllowed(parsed.data.password);
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      return res.status(400).json({ error: passwordErrorMessage(code) });
    }

    const { email, name, password } = parsed.data;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: "Unable to register with this email" });
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email,
        name,
        role: "ADMIN",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
      select: meSelect,
    });

    const defaultOrg = await prisma.organization.findFirst({ where: { slug: "default" } });
    if (defaultOrg) {
      await prisma.orgMembership.upsert({
        where: { organizationId_userId: { organizationId: defaultOrg.id, userId: user.id } },
        create: { organizationId: defaultOrg.id, userId: user.id, role: OrgRole.ADMIN },
        update: { role: OrgRole.ADMIN },
      });
    }

    const { csrfToken } = setSessionCookies(res, { userId: user.id, role: user.role });
    clearAuthFailures(req);
    return res.json({ user, csrfToken });
  }),
);

authRouter.post(
  "/login",
  authRateLimit(),
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const { email, password } = parsed.data;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      noteAuthFailure(req);
      return res.status(401).json({ error: GENERIC_AUTH_ERROR });
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      noteAuthFailure(req);
      return res.status(401).json({ error: GENERIC_AUTH_ERROR });
    }

    if (!user.emailVerifiedAt) {
      return res.status(403).json({
        error: "Email not verified. Check your inbox for a verification link.",
        code: "EMAIL_NOT_VERIFIED",
      });
    }

    // Pending deletion (7-day grace): successful login cancels deletion and reactivates.
    // Deactivated without a PENDING request → block (should not happen in normal flow).
    if (user.deactivatedAt) {
      const { cancelPendingDeletionIfAny } = await import("../lib/accountDeletion");
      const cancelled = await cancelPendingDeletionIfAny(user.id);
      if (!cancelled) {
        return res.status(403).json({
          error: "This account is deactivated.",
          code: "ACCOUNT_DEACTIVATED",
        });
      }
    }

    const { csrfToken } = setSessionCookies(res, { userId: user.id, role: user.role });
    clearAuthFailures(req);
    return res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        photoUrl: user.photoUrl,
        researchInterests: user.researchInterests,
        participantType: user.participantType,
        engagementPoints: user.engagementPoints,
        emailVerifiedAt: user.emailVerifiedAt,
      },
      csrfToken,
    });
  }),
);

authRouter.post(
  "/logout",
  requireAuth,
  requireCsrf,
  asyncHandler(async (_req, res) => {
    clearSessionCookies(res);
    return res.json({ ok: true });
  }),
);

authRouter.post(
  "/forgot-password",
  authRateLimit(),
  asyncHandler(async (req, res) => {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const email = parsed.data.email.trim();
    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });
    if (user) {
      const raw = generateOpaqueToken(32);
      const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordResetTokenHash: hashToken(raw),
          passwordResetTokenExpiresAt: expiresAt,
        },
      });
      const base = env.webBaseUrl.replace(/\/$/, "");
      const resetUrl = `${base}/reset-password/${raw}`;

      let eventName: string | undefined;
      const eventRef = parsed.data.eventSlug?.trim();
      if (eventRef) {
        const lower = eventRef.toLowerCase();
        const ev = await prisma.event.findFirst({
          where: { slug: lower },
          select: { name: true },
        });
        if (ev) eventName = ev.name;
      }

      await sendPasswordResetEmail({ to: user.email, name: user.name, resetUrl, eventName });
    }

    return res.json({ ok: true, message: GENERIC_FORGOT });
  }),
);

authRouter.post(
  "/reset-password",
  authRateLimit(),
  asyncHandler(async (req, res) => {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    try {
      await assertPasswordAllowed(parsed.data.password);
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      return res.status(400).json({ error: passwordErrorMessage(code) });
    }

    const tokenHash = hashToken(parsed.data.token);
    const user = await prisma.user.findFirst({
      where: {
        passwordResetTokenHash: tokenHash,
        passwordResetTokenExpiresAt: { gt: new Date() },
      },
    });
    if (!user) {
      return res.status(400).json({ error: "Invalid or expired reset link" });
    }

    const passwordHash = await hashPassword(parsed.data.password);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordResetTokenHash: null,
        passwordResetTokenExpiresAt: null,
      },
    });

    return res.json({ ok: true });
  }),
);

authRouter.get(
  "/verify-email/:token",
  asyncHandler(async (req, res) => {
    const raw = String(req.params.token || "");
    if (raw.length < 16) return res.status(400).json({ error: "Invalid or expired verification link" });
    const user = await prisma.user.findFirst({
      where: {
        emailVerifyTokenHash: hashToken(raw),
        emailVerifyTokenExpiresAt: { gt: new Date() },
      },
    });
    if (!user) {
      return res.status(400).json({ error: "Invalid or expired verification link" });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: new Date(),
        emailVerifyTokenHash: null,
        emailVerifyTokenExpiresAt: null,
      },
    });
    return res.json({ ok: true });
  }),
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user?.id || "" },
      select: meSelect,
    });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    let isEventAdmin = false;
    let orgRole: OrgRole | null = null;
    let eventRole: EventMemberRole | null = null;
    const eventId = getRequestedEventId(req);
    if (eventId && req.user) {
      try {
        const access = await requireEventAccess(req.user.id, eventId, { requireMembership: false });
        isEventAdmin = access.canManageEvent;
        orgRole = access.orgRole;
        eventRole = access.eventRole;
      } catch {
        /* event missing — leave flags false */
      }
    }

    return res.json({ ...user, isEventAdmin, orgRole, eventRole });
  }),
);

authRouter.post(
  "/me/reset-engagement",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { engagementPoints: 0 },
      select: meSelect,
    });
    return res.json(user);
  }),
);

const profileSchema = z.object({
  name: z.string().min(1).optional(),
  researchInterests: z.string().max(4000).optional(),
  title: z.string().max(200).optional().nullable(),
  affiliation: z.string().max(200).optional().nullable(),
  bio: z.string().max(4000).optional().nullable(),
  photoUrl: z.string().max(2_000_000).optional(),
  participantType: z
    .enum(["GRAD_STUDENT", "EDD_STUDENT", "PHD_STUDENT", "EDL_ALUMNI", "PROFESSOR"])
    .nullable()
    .optional(),
});

authRouter.put(
  "/me/profile",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const user = await prisma.user.update({
      where: { id: req.user?.id || "" },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.researchInterests !== undefined ? { researchInterests: parsed.data.researchInterests } : {}),
        ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
        ...(parsed.data.affiliation !== undefined ? { affiliation: parsed.data.affiliation } : {}),
        ...(parsed.data.bio !== undefined ? { bio: parsed.data.bio } : {}),
        ...(parsed.data.photoUrl !== undefined ? { photoUrl: parsed.data.photoUrl } : {}),
        ...(parsed.data.participantType !== undefined ? { participantType: parsed.data.participantType } : {}),
      },
      select: meSelect,
    });

    // Recompute matchmaker embedding when profile text fields change (cache keyed by sourceHash).
    const profileTextTouched =
      parsed.data.name !== undefined ||
      parsed.data.researchInterests !== undefined ||
      parsed.data.title !== undefined ||
      parsed.data.affiliation !== undefined ||
      parsed.data.bio !== undefined;
    if (profileTextTouched && user.id) {
      try {
        const membership = await prisma.eventMembership.findFirst({
          where: { userId: user.id, deletedAt: null },
          select: { eventId: true, event: { select: { organizationId: true } } },
          orderBy: { createdAt: "desc" },
        });
        if (membership) {
          const { ensureProfileEmbedding } = await import("../lib/ai/matchmaker");
          await ensureProfileEmbedding(user.id, {
            organizationId: membership.event.organizationId,
            eventId: membership.eventId,
            userId: user.id,
          });
        }
      } catch {
        // Embedding refresh is best-effort — profile save must succeed regardless.
      }
    }

    return res.json(user);
  }),
);

const profileSetupSchema = z.object({
  token: z.string().min(16),
  password: z.string().min(8),
});

authRouter.get(
  "/profile-setup/:token",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findFirst({
      where: {
        profileSetupTokenHash: hashToken(String(req.params.token || "")),
        profileSetupTokenExpiresAt: { gt: new Date() },
      },
      select: { email: true, name: true, photoUrl: true, researchInterests: true },
    });
    if (!user) {
      return res.status(404).json({ error: "Invalid or expired invite link" });
    }
    return res.json(user);
  }),
);

authRouter.post(
  "/profile-setup",
  authRateLimit(),
  asyncHandler(async (req, res) => {
    const parsed = profileSetupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    try {
      await assertPasswordAllowed(parsed.data.password);
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      return res.status(400).json({ error: passwordErrorMessage(code) });
    }

    const user = await prisma.user.findFirst({
      where: {
        profileSetupTokenHash: hashToken(parsed.data.token),
        profileSetupTokenExpiresAt: { gt: new Date() },
      },
    });
    if (!user) {
      return res.status(400).json({ error: "Invalid or expired invite link" });
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        profileSetupTokenHash: null,
        profileSetupTokenExpiresAt: null,
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
      },
      select: meSelect,
    });

    const { csrfToken } = setSessionCookies(res, { userId: updated.id, role: updated.role });
    return res.json({ user: updated, csrfToken });
  }),
);

/** Regenerate account-setup invite for a pending participant (roster one-click). */
authRouter.post(
  "/regenerate-invite/:userId",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });

    const targetId = req.params.userId;
    const membership = await prisma.eventMembership.findUnique({
      where: { eventId_userId: { eventId: event.id, userId: targetId } },
    });
    if (!membership) throw new HttpError(404, { error: "Participant not found for this event" });

    const { raw, hash, expiresAt } = newInviteToken();
    await prisma.user.update({
      where: { id: targetId },
      data: {
        profileSetupTokenHash: hash,
        profileSetupTokenExpiresAt: expiresAt,
      },
    });

    const base = env.webBaseUrl.replace(/\/$/, "");
    return res.json({
      ok: true,
      inviteUrl: `${base}/invite/${raw}?event=${encodeURIComponent(event.id)}`,
      expiresAt: expiresAt.toISOString(),
    });
  }),
);
