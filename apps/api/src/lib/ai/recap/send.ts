/**
 * Explicit organizer send for EventRecapEmail — routes via announcements email path.
 * Generate/regenerate NEVER call this.
 */

import {
  AnnouncementAudience,
  EventMemberRole,
  NotificationKind,
  RecapEmailStatus,
} from "@prisma/client";
import { brand } from "@event-app/config";
import { prisma } from "../../db";
import { HttpError } from "../../authorization";
import { getEmailProvider } from "../../email";
import { allAttendeeUserIds, notifyMany } from "../../notifications";

const EMAIL_RATE_LIMIT_PER_HOUR = Number(process.env.ANNOUNCEMENT_EMAIL_RATE_PER_HOUR || 3);

async function assertEmailRateLimit(eventId: string): Promise<void> {
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendRecapEmail(input: {
  recapEmailId: string;
  eventId: string;
  actorId: string;
}): Promise<{ announcementId: string; recipientCount: number }> {
  const email = await prisma.eventRecapEmail.findFirst({
    where: { id: input.recapEmailId, recap: { eventId: input.eventId } },
    include: {
      recap: { select: { id: true, eventId: true, event: { select: { id: true, name: true } } } },
    },
  });
  if (!email) throw new HttpError(404, { error: "Recap email not found" });
  if (email.status === RecapEmailStatus.SENT) {
    throw new HttpError(409, { error: "Email already sent" });
  }
  if (email.status === RecapEmailStatus.SUPERSEDED) {
    throw new HttpError(409, { error: "Email was superseded — send the live draft instead" });
  }

  const event = email.recap.event;
  let recipientIds: string[];
  let audience: AnnouncementAudience = AnnouncementAudience.EVERYONE;
  let audienceRole: EventMemberRole | null = null;

  if (email.kind === "THANK_YOU_SPEAKER" || email.audienceRole === "SPEAKER") {
    audience = AnnouncementAudience.ROLE;
    audienceRole = EventMemberRole.SPEAKER;
    const rows = await prisma.eventMembership.findMany({
      where: { eventId: event.id, deletedAt: null, role: EventMemberRole.SPEAKER },
      select: { userId: true },
    });
    recipientIds = rows.map((r) => r.userId);
  } else if (email.kind === "THANK_YOU_ATTENDEE" || email.audienceRole === "ATTENDEE") {
    audience = AnnouncementAudience.ROLE;
    audienceRole = EventMemberRole.ATTENDEE;
    const rows = await prisma.eventMembership.findMany({
      where: { eventId: event.id, deletedAt: null, role: EventMemberRole.ATTENDEE },
      select: { userId: true },
    });
    recipientIds = rows.map((r) => r.userId);
  } else {
    recipientIds = await allAttendeeUserIds(event.id);
  }

  if (recipientIds.length === 0) {
    throw new HttpError(400, { error: "No recipients match this segment" });
  }

  await assertEmailRateLimit(event.id);

  const announcement = await prisma.announcement.create({
    data: {
      eventId: event.id,
      title: email.subject.trim(),
      body: email.body.trim(),
      createdById: input.actorId,
      audience,
      audienceRole,
      sendEmail: true,
      isEmergency: false,
      isPreview: false,
      publishedAt: new Date(),
    },
  });

  const { degradedCount } = await notifyMany(
    recipientIds.map((userId) => ({
      userId,
      eventId: event.id,
      kind: NotificationKind.ANNOUNCEMENT,
      title: announcement.title,
      body: announcement.body.slice(0, 400),
      announcementId: announcement.id,
    })),
  );

  await prisma.announcementAuditLog.create({
    data: {
      announcementId: announcement.id,
      eventId: event.id,
      actorId: input.actorId,
      action: "PUBLISH",
      payload: {
        recipientCount: recipientIds.length,
        degradedCount,
        source: "event_recap",
        recapEmailId: email.id,
        audience,
      },
    },
  });

  await prisma.announcementAuditLog.create({
    data: {
      announcementId: announcement.id,
      eventId: event.id,
      actorId: input.actorId,
      action: "EMAIL_ATTEMPT",
      payload: { recipientCount: recipientIds.length, source: "event_recap" },
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
        subject: `${event.name}: ${announcement.title}`,
        logLabel: "recap_email",
        html: `<p><strong>${escapeHtml(event.name)}</strong></p><h2>${escapeHtml(announcement.title)}</h2><p>${escapeHtml(announcement.body).replace(/\n/g, "<br/>")}</p>`,
      })
      .catch(() => undefined);
  }

  const sentAt = new Date();
  await prisma.eventRecapEmail.update({
    where: { id: email.id },
    data: {
      status: RecapEmailStatus.SENT,
      sentAt,
      sentViaAnnouncementId: announcement.id,
    },
  });

  return { announcementId: announcement.id, recipientCount: recipientIds.length };
}
