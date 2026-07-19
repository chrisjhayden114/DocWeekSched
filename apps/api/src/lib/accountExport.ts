/**
 * GDPR self-service account export (Phase 6 Chunk B).
 * Self-only JSON snapshot — no migration required.
 */

import { prisma } from "./db";
import { writeAuditLog } from "./ai/audit";

export type AccountExportPayload = {
  exportedAt: string;
  subjectUserId: string;
  profile: {
    id: string;
    email: string;
    name: string;
    role: string;
    title: string | null;
    affiliation: string | null;
    bio: string | null;
    researchInterests: string | null;
    participantType: string | null;
    photoUrl: string | null;
    emailVerifiedAt: string | null;
    createdAt: string;
    engagementPoints: number;
  };
  orgMemberships: Array<{
    organizationId: string;
    organizationName: string;
    role: string;
    createdAt: string;
  }>;
  eventMemberships: Array<{
    eventId: string;
    eventName: string;
    eventSlug: string;
    role: string;
    createdAt: string;
  }>;
  attendance: Array<{
    sessionId: string;
    sessionTitle: string;
    eventId: string;
    status: string;
    joinMode: string | null;
    updatedAt: string;
  }>;
  checkIns: Array<{
    eventId: string;
    method: string;
    checkedInAt: string;
  }>;
  messageMetadata: Array<{
    messageId: string;
    conversationId: string;
    createdAt: string;
    /** Body omitted from export metadata view — length only (minimize residual content risk). */
    bodyLength: number;
  }>;
};

/**
 * Build a JSON-serializable export for exactly `userId`.
 * Never includes other users' emails, message bodies, or profiles.
 */
export async function buildAccountExport(userId: string): Promise<AccountExportPayload | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      title: true,
      affiliation: true,
      bio: true,
      researchInterests: true,
      participantType: true,
      photoUrl: true,
      emailVerifiedAt: true,
      createdAt: true,
      engagementPoints: true,
    },
  });
  if (!user) return null;

  const [orgMemberships, eventMemberships, attendance, checkIns, messages] = await Promise.all([
    prisma.orgMembership.findMany({
      where: { userId },
      select: {
        role: true,
        createdAt: true,
        organization: { select: { id: true, name: true } },
      },
    }),
    prisma.eventMembership.findMany({
      where: { userId },
      select: {
        role: true,
        createdAt: true,
        event: { select: { id: true, name: true, slug: true } },
      },
    }),
    prisma.sessionAttendance.findMany({
      where: { userId },
      select: {
        status: true,
        joinMode: true,
        updatedAt: true,
        session: { select: { id: true, title: true, eventId: true } },
      },
    }),
    prisma.checkIn.findMany({
      where: { userId },
      select: { eventId: true, method: true, createdAt: true },
    }),
    prisma.conversationMessage.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 5_000,
      select: { id: true, conversationId: true, createdAt: true, body: true },
    }),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    subjectUserId: user.id,
    profile: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      title: user.title,
      affiliation: user.affiliation,
      bio: user.bio,
      researchInterests: user.researchInterests,
      participantType: user.participantType,
      photoUrl: user.photoUrl,
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      engagementPoints: user.engagementPoints,
    },
    orgMemberships: orgMemberships.map((m) => ({
      organizationId: m.organization.id,
      organizationName: m.organization.name,
      role: m.role,
      createdAt: m.createdAt.toISOString(),
    })),
    eventMemberships: eventMemberships.map((m) => ({
      eventId: m.event.id,
      eventName: m.event.name,
      eventSlug: m.event.slug,
      role: m.role,
      createdAt: m.createdAt.toISOString(),
    })),
    attendance: attendance.map((a) => ({
      sessionId: a.session.id,
      sessionTitle: a.session.title,
      eventId: a.session.eventId,
      status: a.status,
      joinMode: a.joinMode,
      updatedAt: a.updatedAt.toISOString(),
    })),
    checkIns: checkIns.map((c) => ({
      eventId: c.eventId,
      method: c.method,
      checkedInAt: c.createdAt.toISOString(),
    })),
    messageMetadata: messages.map((m) => ({
      messageId: m.id,
      conversationId: m.conversationId,
      createdAt: m.createdAt.toISOString(),
      bodyLength: m.body?.length ?? 0,
    })),
  };
}

export async function exportAccountForUser(userId: string): Promise<AccountExportPayload | null> {
  const payload = await buildAccountExport(userId);
  if (!payload) return null;
  await writeAuditLog({
    actorUserId: userId,
    action: "OTHER",
    entityType: "account_export",
    entityId: userId,
    payload: {
      kind: "DATA_EXPORT",
      exportedAt: payload.exportedAt,
      keys: Object.keys(payload),
    },
  });
  return payload;
}
