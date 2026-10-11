/**
 * PRESENTER-ROSTER-1 — who has joined a presenter's sessions, shaped for
 * the presenter portal and the session-page panel.
 *
 * The payload is deliberately small. Names come only from JOINING attendees
 * who are visible in the attendee directory (the same opt-in the directory
 * itself uses). Emails, user ids, and join mode never leave this file.
 */

import { SessionAttendanceStatus } from "@prisma/client";
import {
  presenterRosterVisibilityOrDefault,
  type PresenterRosterAttendee,
  type PresenterRosterSession,
  type PresenterRosterVisibility,
} from "@event-app/shared";
import { prisma } from "./db";

/** The directory's attendee-facing rule: opted in, and not soft-deleted. */
export const DIRECTORY_VISIBLE_MEMBERSHIP = {
  directoryOptIn: true,
  deletedAt: null,
} as const;

export function rosterVisibilityOf(value: unknown): PresenterRosterVisibility {
  return presenterRosterVisibilityOrDefault(value);
}

function displayNameOf(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed || "Attendee";
}

function affiliationOf(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function shapeRosterSession(input: {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  roomName: string | null;
  inPersonCapacity: number | null;
  virtualCapacity: number | null;
  joinedCount: number;
  waitlistCount: number;
  visibility: PresenterRosterVisibility;
  attendees?: PresenterRosterAttendee[];
  hiddenCount?: number;
}): PresenterRosterSession {
  const row: PresenterRosterSession = {
    id: input.id,
    title: input.title,
    startsAt: input.startsAt.toISOString(),
    endsAt: input.endsAt.toISOString(),
    roomName: input.roomName,
    joinedCount: input.joinedCount,
    inPersonCapacity: input.inPersonCapacity,
    virtualCapacity: input.virtualCapacity,
    waitlistCount: input.waitlistCount,
  };
  if (input.visibility === "NAMES") {
    row.attendees = input.attendees ?? [];
    row.hiddenCount = input.hiddenCount ?? 0;
  }
  return row;
}

async function loadSessionsForRoster(sessionIds: string[]) {
  if (sessionIds.length === 0) return [];
  return prisma.session.findMany({
    where: { id: { in: sessionIds } },
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      inPersonCapacity: true,
      virtualCapacity: true,
      room: { select: { name: true } },
      _count: {
        select: {
          attendances: { where: { status: SessionAttendanceStatus.JOINING } },
          waitlistEntries: { where: { promotedAt: null } },
        },
      },
    },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
  });
}

async function namedJoiningAttendees(
  eventId: string,
  sessionIds: string[],
): Promise<Map<string, { visible: PresenterRosterAttendee[]; hiddenCount: number }>> {
  const out = new Map<string, { visible: PresenterRosterAttendee[]; hiddenCount: number }>();
  for (const id of sessionIds) out.set(id, { visible: [], hiddenCount: 0 });
  if (sessionIds.length === 0) return out;

  const rows = await prisma.sessionAttendance.findMany({
    where: {
      sessionId: { in: sessionIds },
      status: SessionAttendanceStatus.JOINING,
    },
    select: {
      sessionId: true,
      user: { select: { id: true, name: true, affiliation: true } },
    },
  });

  const userIds = [...new Set(rows.map((r) => r.user.id))];
  const visibleMembers = await prisma.eventMembership.findMany({
    where: {
      eventId,
      userId: { in: userIds },
      ...DIRECTORY_VISIBLE_MEMBERSHIP,
    },
    select: { userId: true },
  });
  const visibleIds = new Set(visibleMembers.map((m) => m.userId));

  for (const row of rows) {
    const bucket = out.get(row.sessionId);
    if (!bucket) continue;
    if (visibleIds.has(row.user.id)) {
      bucket.visible.push({
        displayName: displayNameOf(row.user.name),
        ...(affiliationOf(row.user.affiliation)
          ? { affiliation: affiliationOf(row.user.affiliation) }
          : {}),
      });
    } else {
      bucket.hiddenCount += 1;
    }
  }

  for (const bucket of out.values()) {
    bucket.visible.sort((a, b) =>
      a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }),
    );
  }
  return out;
}

export async function buildPresenterRosterSessions(input: {
  eventId: string;
  sessionIds: string[];
  visibility: PresenterRosterVisibility;
}): Promise<PresenterRosterSession[]> {
  const sessions = await loadSessionsForRoster(input.sessionIds);
  const names =
    input.visibility === "NAMES"
      ? await namedJoiningAttendees(input.eventId, sessions.map((s) => s.id))
      : null;

  return sessions.map((session) => {
    const named = names?.get(session.id);
    return shapeRosterSession({
      id: session.id,
      title: session.title,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      roomName: session.room?.name ?? null,
      inPersonCapacity: session.inPersonCapacity,
      virtualCapacity: session.virtualCapacity,
      joinedCount: session._count.attendances,
      waitlistCount: session._count.waitlistEntries,
      visibility: input.visibility,
      attendees: named?.visible,
      hiddenCount: named?.hiddenCount,
    });
  });
}

/**
 * Sessions a portal speaker is presenting: SessionSpeaker, the legacy
 * Session.speakerId user link (matched via the portal invite email), and any
 * ReadinessAssignment whose subject is a session.
 */
export async function sessionIdsForPortalSpeaker(input: {
  eventId: string;
  speakerId: string;
  portalEmail: string;
}): Promise<string[]> {
  const email = input.portalEmail.trim().toLowerCase();
  const [fromRoster, fromLegacy, fromAssignments] = await Promise.all([
    prisma.sessionSpeaker.findMany({
      where: { speakerId: input.speakerId, session: { eventId: input.eventId } },
      select: { sessionId: true },
    }),
    email
      ? prisma.session.findMany({
          where: {
            eventId: input.eventId,
            speaker: { email },
          },
          select: { id: true },
        })
      : Promise.resolve([]),
    prisma.readinessAssignment.findMany({
      where: {
        eventId: input.eventId,
        speakerId: input.speakerId,
        sessionId: { not: null },
      },
      select: { sessionId: true },
    }),
  ]);

  const ids = new Set<string>();
  for (const row of fromRoster) ids.add(row.sessionId);
  for (const row of fromLegacy) ids.add(row.id);
  for (const row of fromAssignments) {
    if (row.sessionId) ids.add(row.sessionId);
  }
  return [...ids];
}

/**
 * A signed-in user may see the session-page roster when they are the
 * session's linked speaker (Session.speakerId) or their account email
 * matches a readiness portal invite for one of the session's SessionSpeaker
 * records.
 */
export async function isSessionPresenter(input: {
  sessionId: string;
  eventId: string;
  userId: string;
  userEmail: string;
}): Promise<boolean> {
  const session = await prisma.session.findFirst({
    where: { id: input.sessionId, eventId: input.eventId },
    select: {
      speakerId: true,
      sessionSpeakers: { select: { speakerId: true } },
    },
  });
  if (!session) return false;
  if (session.speakerId && session.speakerId === input.userId) return true;

  const speakerIds = session.sessionSpeakers.map((s) => s.speakerId);
  if (speakerIds.length === 0) return false;
  const email = input.userEmail.trim().toLowerCase();
  if (!email) return false;

  const access = await prisma.readinessPortalAccess.findFirst({
    where: {
      eventId: input.eventId,
      speakerId: { in: speakerIds },
      email,
    },
    select: { id: true },
  });
  return Boolean(access);
}
