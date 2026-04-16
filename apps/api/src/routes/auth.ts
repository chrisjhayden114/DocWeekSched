import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db";
import { hashPassword, signToken, verifyPassword } from "../lib/auth";
import { env } from "../lib/env";
import { AuthedRequest, requireAuth } from "../lib/middleware";

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
  role: z.enum(["ATTENDEE", "SPEAKER"]).default("ATTENDEE"),
  researchInterests: z.string().optional(),
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

  const { email, name, password, role, researchInterests } = parsed.data;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "Email already in use" });
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: { email, name, role, researchInterests, passwordHash },
    select: { id: true, email: true, name: true, role: true, photoUrl: true, researchInterests: true, engagementPoints: true },
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
    select: { id: true, email: true, name: true, role: true, photoUrl: true, researchInterests: true, engagementPoints: true },
  });

  const token = signToken({ userId: user.id, role: user.role });
  return res.json({ user, token });
});

const loginSchema = z.object({
  email: z.string().email(),
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
      engagementPoints: user.engagementPoints,
    },
    token,
  });
});

const profileSchema = z.object({
  name: z.string().min(1).optional(),
  researchInterests: z.string().max(4000).optional(),
  photoUrl: z.string().max(2_000_000).optional(),
});

authRouter.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user?.id || "" },
    select: { id: true, email: true, name: true, role: true, photoUrl: true, researchInterests: true, engagementPoints: true },
  });

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

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
    },
    select: { id: true, email: true, name: true, role: true, photoUrl: true, researchInterests: true, engagementPoints: true },
  });

  return res.json(user);
});
