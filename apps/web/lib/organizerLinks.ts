/**
 * H1 / DESIGN_PHASE_H D4 — paths from the organizer console into the public
 * page and the attendee app. Keep URL shape here so pages don't drift.
 */

/** Relative public event path (`/e/{slug}`). */
export function publicEventUrl(slug: string): string {
  return `/e/${slug}`;
}

/**
 * Open the attendee app scoped to this event.
 * Sets localStorage.activeEventId first — /dashboard reads that key to pick
 * the event — then does a full navigation (organizer console → app).
 */
export function openAttendeeApp(eventId: string): void {
  try {
    window.localStorage.setItem("activeEventId", eventId);
  } catch {
    /* ignore quota / private mode */
  }
  window.location.href = "/dashboard?tab=Agenda";
}
