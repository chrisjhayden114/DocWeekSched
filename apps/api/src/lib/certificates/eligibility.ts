/**
 * Certificate eligibility — deterministic SQL/code only.
 * Session rules use SessionAttendance.status = JOINING (registration), not door check-in.
 * Do not import from lib/ai.
 */

import {
  CertificateEligibilityRule,
  SessionAttendanceStatus,
  type CertificateTemplate,
} from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../authorization";

export type EligibilityTemplateInput = Pick<
  CertificateTemplate,
  "eventId" | "eligibilityRule" | "minSessions" | "requiredSessionIds"
>;

export type ValidateTemplateEligibilityInput = {
  eventId: string;
  eligibilityRule: CertificateEligibilityRule;
  minSessions?: number | null;
  requiredSessionIds?: string[];
};

/**
 * Validate organizer template fields before save.
 * REQUIRED_SESSIONS: every id must belong to the event.
 * MIN_SESSIONS: minSessions >= 1.
 */
export async function validateTemplateEligibility(
  input: ValidateTemplateEligibilityInput,
): Promise<{ minSessions: number | null; requiredSessionIds: string[] }> {
  const requiredSessionIds = input.requiredSessionIds ?? [];

  if (input.eligibilityRule === CertificateEligibilityRule.MIN_SESSIONS) {
    const min = input.minSessions ?? null;
    if (min == null || !Number.isInteger(min) || min < 1) {
      throw new HttpError(400, {
        error: "minSessions must be an integer >= 1 when eligibilityRule is MIN_SESSIONS",
      });
    }
    return { minSessions: min, requiredSessionIds: [] };
  }

  if (input.eligibilityRule === CertificateEligibilityRule.REQUIRED_SESSIONS) {
    if (!requiredSessionIds.length) {
      throw new HttpError(400, {
        error: "requiredSessionIds must be non-empty when eligibilityRule is REQUIRED_SESSIONS",
      });
    }
    const unique = [...new Set(requiredSessionIds)];
    const sessions = await prisma.session.findMany({
      where: { eventId: input.eventId, id: { in: unique } },
      select: { id: true },
    });
    if (sessions.length !== unique.length) {
      throw new HttpError(400, {
        error: "requiredSessionIds must all belong to this event",
      });
    }
    return { minSessions: null, requiredSessionIds: unique };
  }

  // ANY_CHECKIN
  return { minSessions: null, requiredSessionIds: [] };
}

/** Active roster: EventMembership with deletedAt IS NULL. */
export async function listActiveRosterUserIds(eventId: string): Promise<string[]> {
  const rows = await prisma.eventMembership.findMany({
    where: { eventId, deletedAt: null },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

export async function isUserEligible(
  template: EligibilityTemplateInput,
  userId: string,
): Promise<boolean> {
  switch (template.eligibilityRule) {
    case CertificateEligibilityRule.ANY_CHECKIN: {
      const row = await prisma.checkIn.findUnique({
        where: { userId_eventId: { userId, eventId: template.eventId } },
        select: { id: true },
      });
      return Boolean(row);
    }
    case CertificateEligibilityRule.MIN_SESSIONS: {
      const min = template.minSessions ?? 0;
      if (min < 1) return false;
      const count = await prisma.sessionAttendance.count({
        where: {
          userId,
          status: SessionAttendanceStatus.JOINING,
          session: { eventId: template.eventId },
        },
      });
      return count >= min;
    }
    case CertificateEligibilityRule.REQUIRED_SESSIONS: {
      const required = template.requiredSessionIds ?? [];
      if (!required.length) return false;
      const joined = await prisma.sessionAttendance.findMany({
        where: {
          userId,
          status: SessionAttendanceStatus.JOINING,
          sessionId: { in: required },
        },
        select: { sessionId: true },
      });
      const have = new Set(joined.map((j) => j.sessionId));
      return required.every((id) => have.has(id));
    }
    default:
      return false;
  }
}

/** Eligible active-roster user ids for a template. */
export async function listEligibleUserIds(template: EligibilityTemplateInput): Promise<string[]> {
  const roster = await listActiveRosterUserIds(template.eventId);
  if (!roster.length) return [];

  switch (template.eligibilityRule) {
    case CertificateEligibilityRule.ANY_CHECKIN: {
      const checkIns = await prisma.checkIn.findMany({
        where: { eventId: template.eventId, userId: { in: roster } },
        select: { userId: true },
      });
      return checkIns.map((c) => c.userId);
    }
    case CertificateEligibilityRule.MIN_SESSIONS: {
      const min = template.minSessions ?? 0;
      if (min < 1) return [];
      const grouped = await prisma.sessionAttendance.groupBy({
        by: ["userId"],
        where: {
          userId: { in: roster },
          status: SessionAttendanceStatus.JOINING,
          session: { eventId: template.eventId },
        },
        _count: { _all: true },
      });
      return grouped.filter((g) => g._count._all >= min).map((g) => g.userId);
    }
    case CertificateEligibilityRule.REQUIRED_SESSIONS: {
      const required = template.requiredSessionIds ?? [];
      if (!required.length) return [];
      const eligible: string[] = [];
      for (const userId of roster) {
        if (await isUserEligible(template, userId)) eligible.push(userId);
      }
      return eligible;
    }
    default:
      return [];
  }
}
