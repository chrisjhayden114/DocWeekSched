import { randomBytes } from "crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db";
import { hashPassword, signToken, verifyPassword } from "../lib/auth";
import { env } from "../lib/env";
import { getDefaultEventWhenUnspecified } from "../lib/event";
import { sendPasswordResetEmail } from "../lib/mail";
import { AuthedRequest, requireAuth, requireRole } from "../lib/middleware";

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

authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { email, name, password, role, researchInterests, participantType } = parsed.data;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (!existing.profileSetupToken) {
      return res.status(409).json({ error: "Email already in use" });
    }

    const passwordHash = await hashPassword(password);
    const invited = await prisma.user.update({
      where: { id: existing.id },
      data: {
        name,
        role: existing.role === "ATTENDEE" || existing.role === "SPEAKER" ? role : existing.role,
        researchInterests: researchInterests ?? existing.researchInterests,
        participantType: participantType ?? existing.participantType,
        passwordHash,
        profileSetupToken: null,
        profileSetupTokenExpiresAt: null,
      },
      select: { id: true, email: true, name: true, role: true, photoUrl: true, researchInterests: true, participantType: true, engagementPoints: true },
    });

    const token = signToken({ userId: invited.id, role: invited.role });
    return res.json({ user: invited, token });
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: { email, name, role, researchInterests, participantType, passwordHash },
    select: { id: true, email: true, name: true, role: true, photoUrl: true, researchInterests: true, participantType: true, engagementPoints: true },
  });

  const token = signToken({ userId: user.id, role: user.role });
  return res.json({ user, token });
});

authRouter.post("/register-admin", async (req, res) => {
  const parsed = adminRegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  if (!env.adminInviteCode || parsed.data.inviteCode !== env.adminInviteCode) {
    return res.status(403).json({ error: "Invalid admin invite code" });
  }

  const { email, name, password } = parsed.data;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "Email already in use" });
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: { email, name, role: "ADMIN", passwordHash },
    select: { id: true, email: true, name: true, role: true, photoUrl: true, researchInterests: true, participantType: true, engagementPoints: true },
  });

  const token = signToken({ userId: user.id, role: user.role });
  return res.json({ user, token });
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

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = signToken({ userId: user.id, role: user.role });
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
    },
    token,
  });
});

authRouter.post("/forgot-password", async (req, res) => {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const email = parsed.data.email.trim();
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
  });
  if (user) {
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: token,
        passwordResetTokenExpiresAt: expiresAt,
      },
    });
    const base = env.webBaseUrl.replace(/\/$/, "");
    const resetUrl = `${base}/reset-password/${token}`;

    let eventName: string | undefined;
    const eventRef = parsed.data.eventSlug?.trim();
    if (eventRef) {
      const lower = eventRef.toLowerCase();
      const ev = await prisma.event.findFirst({
        where: { OR: [{ id: eventRef }, { slug: lower }] },
        select: { name: true },
      });
      if (ev) eventName = ev.name;
    }
    if (!eventName) {
      const def = await getDefaultEventWhenUnspecified();
      eventName = def.name;
    }

    await sendPasswordResetEmail({ to: user.email, name: user.name, resetUrl, eventName });
  }

  return res.json({ ok: true });
});

authRouter.post("/reset-password", async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const user = await prisma.user.findFirst({
    where: {
      passwordResetToken: parsed.data.token,
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
      passwordResetToken: null,
      passwordResetTokenExpiresAt: null,
    },
  });

  return res.json({ ok: true });
});

const profileSchema = z.object({
  name: z.string().min(1).optional(),
  researchInterests: z.string().max(4000).optional(),
  photoUrl: z.string().max(2_000_000).optional(),
  participantType: z
    .enum(["GRAD_STUDENT", "EDD_STUDENT", "PHD_STUDENT", "EDL_ALUMNI", "PROFESSOR"])
    .nullable()
    .optional(),
});

authRouter.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user?.id || "" },
    select: { id: true, email: true, name: true, role: true, photoUrl: true, researchInterests: true, participantType: true, engagementPoints: true },
  });

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  return res.json(user);
});

const meSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  photoUrl: true,
  researchInterests: true,
  participantType: true,
  engagementPoints: true,
} as const;

authRouter.post("/me/reset-engagement", requireAuth, requireRole(["ADMIN"]), async (req: AuthedRequest, res) => {
  const user = await prisma.user.update({
    where: { id: req.user?.id || "" },
    data: { engagementPoints: 0 },
    select: meSelect,
  });
  return res.json(user);
});

authRouter.put("/me/profile", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const user = await prisma.user.update({
    where: { id: req.user?.id || "" },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.researchInterests !== undefined ? { researchInterests: parsed.data.researchInterests } : {}),
      ...(parsed.data.photoUrl !== undefined ? { photoUrl: parsed.data.photoUrl } : {}),
      ...(parsed.data.participantType !== undefined ? { participantType: parsed.data.participantType } : {}),
    },
    select: meSelect,
  });

  return res.json(user);
});

const profileSetupSchema = z.object({
  token: z.string().min(16),
  password: z.string().min(8),
});

authRouter.get("/profile-setup/:token", async (req, res) => {
  const user = await prisma.user.findFirst({
    where: {
      profileSetupToken: req.params.token,
      OR: [{ profileSetupTokenExpiresAt: null }, { profileSetupTokenExpiresAt: { gt: new Date() } }],
    },
    select: { email: true, name: true, photoUrl: true, researchInterests: true },
  });
  if (!user) {
    return res.status(404).json({ error: "Invalid or expired invite link" });
  }
  return res.json(user);
});

authRouter.post("/profile-setup", async (req, res) => {
  const parsed = profileSetupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const user = await prisma.user.findFirst({
    where: {
      profileSetupToken: parsed.data.token,
      OR: [{ profileSetupTokenExpiresAt: null }, { profileSetupTokenExpiresAt: { gt: new Date() } }],
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
      profileSetupToken: null,
      profileSetupTokenExpiresAt: null,
    },
    select: { id: true, email: true, name: true, role: true, photoUrl: true, researchInterests: true, participantType: true, engagementPoints: true },
  });

  const token = signToken({ userId: updated.id, role: updated.role });
  return res.json({ user: updated, token });
});
