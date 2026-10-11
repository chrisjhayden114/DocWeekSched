/**
 * PRESENTER-ROSTER-1 — view-model helpers for the presenter portal card
 * and the session-page panel. Copy lives here so help tests can assert
 * against the same strings the components render.
 */

import type { PresenterRosterSession } from "@event-app/shared";

export const PRESENTER_PORTAL_SESSIONS_TITLE = "Your sessions";
export const SESSION_PAGE_PRESENTER_ROSTER_TITLE = "You're presenting this session";
export const PRESENTER_ROSTER_EMPTY = "Nobody has added this session yet.";

export function presenterRosterSeats(session: Pick<
  PresenterRosterSession,
  "inPersonCapacity" | "virtualCapacity"
>): number | null {
  const parts = [session.inPersonCapacity, session.virtualCapacity].filter(
    (n): n is number => typeof n === "number" && n > 0,
  );
  if (parts.length === 0) return null;
  return parts.reduce((sum, n) => sum + n, 0);
}

export function presenterRosterJoinedLine(
  session: Pick<PresenterRosterSession, "joinedCount" | "inPersonCapacity" | "virtualCapacity">,
): string {
  const seats = presenterRosterSeats(session);
  if (seats != null) return `${session.joinedCount} of ${seats} seats`;
  return `${session.joinedCount} joined`;
}

export function presenterRosterWaitlistLine(waitlistCount: number): string | null {
  if (waitlistCount <= 0) return null;
  return `+${waitlistCount} waiting`;
}

export function presenterRosterHiddenLine(hiddenCount: number): string | null {
  if (hiddenCount <= 0) return null;
  const who = hiddenCount === 1 ? "1 more who keeps" : `${hiddenCount} more who keep`;
  return `and ${who} their profile private`;
}

export function hasPresenterRosterNames(
  session: PresenterRosterSession,
): session is PresenterRosterSession & { attendees: NonNullable<PresenterRosterSession["attendees"]> } {
  return Array.isArray(session.attendees);
}
