import { randomBytes } from "crypto";
import { Router } from "express";
import { z } from "zod";
import { hashPassword } from "../lib/auth";
import { prisma } from "../lib/db";
import { env } from "../lib/env";
import { sendParticipantInviteEmail } from "../lib/mail";
import { AuthedRequest, requireAuth, requireRole } from "../lib/middleware";

export const attendeesRouter = Router();

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  photoUrl: z.string().max(12_000_000).optional(),
  researchInterests: z.string().max(4000).optional(),
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

attendeesRouter.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const isAdmin = req.user?.role === "ADMIN";

  if (!isAdmin) {
    const users = await prisma.user.findMany({
      select: attendeePublicSelect,
      orderBy: { name: "asc" },
    });
    return res.json(users);
  }

  const users = await prisma.user.findMany({
    select: {
      ...attendeePublicSelect,
      profileSetupToken: true,
      profileSetupTokenExpiresAt: true,
    },
    orderBy: { name: "asc" },
  });

  return res.json(
    users.map((u) => {
      const pending = u.profileSetupToken != null;
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
        inviteStatus,
        inviteExpiresAt: pending && expiresAt ? expiresAt.toISOString() : null,
      };
    }),
  );
});

attendeesRouter.post("/invite", requireAuth, requireRole(["ADMIN"]), async (req: AuthedRequest, res) => {
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const requestedEventId = typeof req.headers["x-event-id"] === "string" ? req.headers["x-event-id"] : undefined;
  if (!requestedEventId) {
    return res.status(400).json({ error: "Select an active event before sending invites" });
  }

  const event = await prisma.event.findUnique({ where: { id: requestedEventId } });
  if (!event) {
    return res.status(404).json({ error: "Event not found" });
  }

  const email = parsed.data.email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "A user with this email already exists" });
  }

  const setupToken = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const passwordHash = await hashPassword(randomBytes(24).toString("hex"));

  await prisma.user.create({
    data: {
      email,
      name: parsed.data.name.trim(),
      photoUrl: parsed.data.photoUrl?.trim() || null,
      researchInterests: parsed.data.researchInterests?.trim() || null,
      role: "ATTENDEE",
      passwordHash,
      profileSetupToken: setupToken,
      profileSetupTokenExpiresAt: expires,
    },
  });

  const base = env.webBaseUrl.replace(/\/$/, "");
  const inviteUrl = `${base}/invite/${setupToken}?event=${encodeURIComponent(event.slug)}`;

  await sendParticipantInviteEmail({
    to: email,
    name: parsed.data.name.trim(),
    eventName: event.name,
    inviteUrl,
  });

  return res.json({ ok: true, inviteUrl });
});
