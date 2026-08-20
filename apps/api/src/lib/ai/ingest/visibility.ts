import { EventStatus, SessionPublishStatus, type Prisma } from "@prisma/client";
import type { EventAccess } from "../../authorization";

/**
 * Attendee-visible sessions: event ACTIVE ∧ publishStatus PUBLISHED.
 * Managers (org STAFF+ / event ADMIN) see all sessions including DRAFT.
 */
export function sessionVisibilityWhere(
  access: EventAccess,
): Prisma.SessionWhereInput {
  return sessionVisibilityWhereFor(access.canManageEvent);
}

/** Same rule for callers that only carry the resolved manage flag, not the EventAccess. */
export function sessionVisibilityWhereFor(
  canManageEvent: boolean,
): Prisma.SessionWhereInput {
  if (canManageEvent) {
    return {};
  }
  return {
    publishStatus: SessionPublishStatus.PUBLISHED,
    event: { status: EventStatus.ACTIVE },
  };
}

/** True when a non-manager may see this session. */
export function isSessionAttendeeVisible(input: {
  canManageEvent: boolean;
  eventStatus: EventStatus;
  publishStatus: SessionPublishStatus;
}): boolean {
  if (input.canManageEvent) return true;
  return (
    input.eventStatus === EventStatus.ACTIVE &&
    input.publishStatus === SessionPublishStatus.PUBLISHED
  );
}
