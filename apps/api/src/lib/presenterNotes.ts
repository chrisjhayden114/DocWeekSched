/**
 * PRESENTER-HOME-B — a presenter writes one plain-text note to everyone who
 * joined a session. The portal token is the credential. No email is sent.
 *
 * The in-app row is a UserNotification with delivery INBOX. It is not pushed
 * and it is not class DIGEST, so the morning digest does not email it.
 * NotificationKind stays an existing value: adding a kind would be a second
 * migration, and this change is only allowed the PresenterNote one.
 */

import {
  NotificationClass,
  NotificationDelivery,
  NotificationKind,
  SessionAttendanceStatus,
} from "@prisma/client";
import { PRESENTER_NOTE_MAX_CHARS, presenterNoteNotificationTitle } from "@event-app/shared";
import { HttpError } from "./authorization";
import { prisma } from "./db";
import { sessionIdsForPortalSpeaker } from "./presenterRoster";
import { portalDenialMessage, type PortalTokenDenial } from "./readiness/portalTokens";
import { resolvePortalAccess } from "./readiness/portal";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOTES_PER_SESSION_PER_DAY = 3;

function portalNotFound(reason: PortalTokenDenial) {
  return new HttpError(404, { error: portalDenialMessage(reason), reason });
}

export async function createPresenterSessionNote(input: {
  token: string;
  sessionId: string;
  body: unknown;
  now?: Date;
}): Promise<{ id: string; body: string; createdAt: string }> {
  const now = input.now ?? new Date();
  const token = input.token.trim();
  const sessionId = input.sessionId.trim();
  if (!token) throw portalNotFound("unknown");

  const access = await resolvePortalAccess(token, now);
  if (!sessionId) throw portalNotFound("unknown");

  const owned = await sessionIdsForPortalSpeaker({
    eventId: access.eventId,
    speakerId: access.speakerId,
    portalEmail: access.email,
  });
  if (!owned.includes(sessionId)) {
    throw new HttpError(404, {
      error: "That session isn't on this link.",
      reason: "unknown",
    });
  }

  if (!access.event.presenterNotesEnabled) {
    throw new HttpError(403, {
      error: "Presenters can't send notes for this event.",
    });
  }

  if (typeof input.body !== "string") {
    throw new HttpError(400, { error: "Enter a note." });
  }
  const body = input.body.trim();
  if (!body) {
    throw new HttpError(400, { error: "Enter a note." });
  }
  if (body.length > PRESENTER_NOTE_MAX_CHARS) {
    throw new HttpError(400, { error: `Keep this under ${PRESENTER_NOTE_MAX_CHARS} characters.` });
  }

  const since = new Date(now.getTime() - DAY_MS);
  const sentToday = await prisma.presenterNote.count({
    where: { sessionId, createdAt: { gte: since } },
  });
  if (sentToday >= NOTES_PER_SESSION_PER_DAY) {
    throw new HttpError(429, {
      error: "You can send 3 notes about this session per day.",
    });
  }

  const session = await prisma.session.findFirst({
    where: { id: sessionId, eventId: access.eventId },
    select: { id: true, title: true },
  });
  if (!session) {
    throw new HttpError(404, {
      error: "That session isn't on this link.",
      reason: "unknown",
    });
  }

  const joining = await prisma.sessionAttendance.findMany({
    where: { sessionId, status: SessionAttendanceStatus.JOINING },
    select: { userId: true },
  });

  const title = presenterNoteNotificationTitle(access.speaker.name, session.title);
  const note = await prisma.$transaction(async (tx) => {
    const created = await tx.presenterNote.create({
      data: {
        sessionId,
        speakerId: access.speakerId,
        body,
      },
      select: { id: true, body: true, createdAt: true },
    });
    if (joining.length > 0) {
      await tx.userNotification.createMany({
        data: joining.map((row) => ({
          userId: row.userId,
          eventId: access.eventId,
          kind: NotificationKind.SESSION_CHANGED,
          class: NotificationClass.INTERRUPT,
          delivery: NotificationDelivery.INBOX,
          title,
          body,
          sessionId,
        })),
      });
    }
    return created;
  });

  return { id: note.id, body: note.body, createdAt: note.createdAt.toISOString() };
}
