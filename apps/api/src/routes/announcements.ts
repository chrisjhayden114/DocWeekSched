import { Router } from "express";
import { z } from "zod";
import {
  AnnouncementAudience,
  EventMemberRole,
  NotificationKind,
  SessionAttendanceStatus,
  SessionJoinMode,
} from "@prisma/client";
import { asyncHandler, HttpError, requireEventAccess } from "../lib/authorization";
import { prisma } from "../lib/db";
import { resolveEventFromRequest } from "../lib/requestEvent";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";
import { allAttendeeUserIds, minRemainingPushBudget, notifyMany } from "../lib/notifications";
import { getEmailProvider } from "../lib/email";
import { brand } from "@event-app/config";

export const announcementsRouter = Router();

const audienceSchema = z.enum(["EVERYONE", "ROLE", "SESSION_JOINERS", "ATTENDANCE_MODE"]);

const composeSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(10_000),
  audience: audienceSchema.default("EVERYONE"),
  audienceRole: z.enum(["ADMIN", "ATTENDEE", "SPEAKER"]).optional().nullable(),
  sessionId: z.string().optional().nullable(),
  attendanceMode: z.enum(["VIRTUAL", "IN_PERSON", "ASYNC"]).optional().nullable(),
  sendEmail: z.boolean().optional().default(false),
  isEmergency: z.boolean().optional().default(false),
  emergencyConfirm: z.string().optional(),
  preview: z.boolean().optional().default(false),
});

const EMAIL_RATE_LIMIT_PER_HOUR = Number(process.env.ANNOUNCEMENT_EMAIL_RATE_PER_HOUR || 3);

async function resolveRecipientIds(
  eventId: string,
  input: z.infer<typeof composeSchema>,
): Promise<string[]> {
  if (input.audience === "EVERYONE") {
    return allAttendeeUserIds(eventId);
  }
  if (input.audience === "ROLE") {
    if (!input.audienceRole) throw new HttpError(400, { error: "audienceRole is required" });
    const rows = await prisma.eventMembership.findMany({
      where: { eventId, deletedAt: null, role: input.audienceRole as EventMemberRole },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }
  if (input.audience === "SESSION_JOINERS") {
    if (!input.sessionId) throw new HttpError(400, { error: "sessionId is required" });
    const session = await prisma.session.findFirst({ where: { id: input.sessionId, eventId } });
    if (!session) throw new HttpError(400, { error: "Session not found on this event" });
    const rows = await prisma.sessionAttendance.findMany({
      where: { sessionId: session.id, status: SessionAttendanceStatus.JOINING },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }
  // ATTENDANCE_MODE
  if (!input.attendanceMode) throw new HttpError(400, { error: "attendanceMode is required" });
  const rows = await prisma.sessionAttendance.findMany({
    where: {
      status: SessionAttendanceStatus.JOINING,
      joinMode: input.attendanceMode as SessionJoinMode,
      session: { eventId },
    },
    select: { userId: true },
    distinct: ["userId"],
  });
  return rows.map((r) => r.userId);
}

async function assertEmailRateLimit(eventId: string) {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const count = await prisma.announcementAuditLog.count({
    where: { eventId, action: "EMAIL_ATTEMPT", createdAt: { gte: since } },
  });
  if (count >= EMAIL_RATE_LIMIT_PER_HOUR) {
    throw new HttpError(429, {
      error: `Email announcement rate limit (${EMAIL_RATE_LIMIT_PER_HOUR}/hour) reached. Try again later.`,
    });
  }
}

announcementsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id);

    const announcements = await prisma.announcement.findMany({
      where: {
        eventId: event.id,
        OR: [{ isPreview: false, publishedAt: { not: null } }, { isPreview: true, createdById: req.user!.id }],
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return res.json(announcements);
  }),
);

/** Budget meter for the announcement composer. */
announcementsRouter.get(
  "/budget",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    const audience = (req.query.audience as string) || "EVERYONE";
    const parsed = composeSchema.partial().safeParse({
      title: "x",
      body: "x",
      audience,
      audienceRole: req.query.audienceRole,
      sessionId: req.query.sessionId,
      attendanceMode: req.query.attendanceMode,
    });
    const draft = {
      title: "x",
      body: "x",
      audience: (parsed.success && parsed.data.audience) || "EVERYONE",
      audienceRole: parsed.success ? parsed.data.audienceRole : null,
      sessionId: parsed.success ? parsed.data.sessionId : null,
      attendanceMode: parsed.success ? parsed.data.attendanceMode : null,
      sendEmail: false,
      isEmergency: false,
      preview: false,
    } as z.infer<typeof composeSchema>;

    let recipientIds: string[] = [];
    try {
      recipientIds = await resolveRecipientIds(event.id, draft);
    } catch {
      recipientIds = await allAttendeeUserIds(event.id);
    }

    const prefs = await prisma.notificationPreference.findMany({
      where: { userId: { in: recipientIds } },
      select: { userId: true, timezone: true, eventId: true },
    });
    const tzMap = new Map<string, string>();
    for (const p of prefs) {
      if (p.eventId === event.id && p.timezone) tzMap.set(p.userId, p.timezone);
      else if (!p.eventId && p.timezone && !tzMap.has(p.userId)) tzMap.set(p.userId, p.timezone);
    }
    const { remaining, ceiling } = await minRemainingPushBudget(recipientIds, tzMap, event.timezone);
    return res.json({
      recipientCount: recipientIds.length,
      ceiling,
      remaining,
      meter: `This will use 1 of your attendees' ${ceiling} daily notifications — ${remaining} remaining today (worst case across segment).`,
    });
  }),
);

announcementsRouter.post(
  "/",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = composeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    const data = parsed.data;
    const actorId = req.user!.id;

    if (data.isEmergency && data.emergencyConfirm !== "EMERGENCY") {
      throw new HttpError(400, {
        error: 'Emergency broadcast requires typing EMERGENCY to confirm',
      });
    }

    if (data.preview) {
      const announcement = await prisma.announcement.create({
        data: {
          eventId: event.id,
          title: data.title.trim(),
          body: data.body.trim(),
          createdById: actorId,
          audience: data.audience as AnnouncementAudience,
          audienceRole: (data.audienceRole as EventMemberRole) || null,
          sessionId: data.sessionId || null,
          attendanceMode: (data.attendanceMode as SessionJoinMode) || null,
          sendEmail: false,
          isEmergency: false,
          isPreview: true,
          publishedAt: new Date(),
        },
      });
      await prisma.announcementAuditLog.create({
        data: {
          announcementId: announcement.id,
          eventId: event.id,
          actorId,
          action: "PREVIEW",
          payload: { recipientCount: 1 },
        },
      });
      await notifyMany([
        {
          userId: actorId,
          eventId: event.id,
          kind: NotificationKind.ANNOUNCEMENT,
          title: `[Preview] ${announcement.title}`,
          body: announcement.body.slice(0, 400),
          announcementId: announcement.id,
        },
      ]);
      return res.status(201).json({ announcement, degradedCount: 0, preview: true });
    }

    const recipientIds = await resolveRecipientIds(event.id, data);
    if (recipientIds.length === 0) {
      throw new HttpError(400, { error: "No recipients match this segment" });
    }

    if (data.sendEmail) await assertEmailRateLimit(event.id);

    const announcement = await prisma.announcement.create({
      data: {
        eventId: event.id,
        title: data.title.trim(),
        body: data.body.trim(),
        createdById: actorId,
        audience: data.audience as AnnouncementAudience,
        audienceRole: (data.audienceRole as EventMemberRole) || null,
        sessionId: data.sessionId || null,
        attendanceMode: (data.attendanceMode as SessionJoinMode) || null,
        sendEmail: data.sendEmail,
        isEmergency: data.isEmergency,
        isPreview: false,
        publishedAt: new Date(),
      },
    });

    const { degradedCount } = await notifyMany(
      recipientIds.map((userId) => ({
        userId,
        eventId: event.id,
        kind: NotificationKind.ANNOUNCEMENT,
        title: data.isEmergency ? `Emergency: ${announcement.title}` : announcement.title,
        body: announcement.body.slice(0, 400),
        announcementId: announcement.id,
        emergency: data.isEmergency,
      })),
    );

    await prisma.announcementAuditLog.create({
      data: {
        announcementId: announcement.id,
        eventId: event.id,
        actorId,
        action: data.isEmergency ? "EMERGENCY_PUBLISH" : "PUBLISH",
        payload: {
          recipientCount: recipientIds.length,
          degradedCount,
          audience: data.audience,
          confirmationOk: data.isEmergency ? true : undefined,
        },
      },
    });

    if (data.sendEmail) {
      await prisma.announcementAuditLog.create({
        data: {
          announcementId: announcement.id,
          eventId: event.id,
          actorId,
          action: "EMAIL_ATTEMPT",
          payload: { recipientCount: recipientIds.length },
        },
      });
      const users = await prisma.user.findMany({
        where: { id: { in: recipientIds } },
        select: { email: true, name: true },
      });
      const from = process.env.RESEND_FROM_EMAIL || `${brand.productName} <onboarding@resend.dev>`;
      for (const u of users.slice(0, 200)) {
        await getEmailProvider()
          .send({
            to: u.email,
            from,
            subject: data.isEmergency
              ? `Emergency — ${event.name}: ${announcement.title}`
              : `${event.name}: ${announcement.title}`,
            logLabel: "announcement",
            html: `<p><strong>${escapeHtml(event.name)}</strong></p><h2>${escapeHtml(announcement.title)}</h2><p>${escapeHtml(announcement.body).replace(/\n/g, "<br/>")}</p>`,
          })
          .catch(() => undefined);
      }
    }

    return res.status(201).json({
      announcement,
      recipientCount: recipientIds.length,
      degradedCount,
      warning:
        degradedCount > 0
          ? `${degradedCount} attendee(s) were over their daily push budget — those copies went to digest instead of push.`
          : null,
    });
  }),
);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
