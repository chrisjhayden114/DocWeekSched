/** Entry-flow redirect helpers (Phase 6). Pure — safe for web + unit tests. */

/** Build the login URL that preserves an event slug/token query. */
export function loginPathWithEvent(event: string): string {
  const trimmed = event.trim();
  return `/login?event=${encodeURIComponent(trimmed)}`;
}

/**
 * If `/` is hit with `?event=`, redirect temporarily (302) to `/login?event=`.
 * Returns null when no redirect is needed.
 */
export function homeEventQueryRedirect(eventQuery: string | string[] | undefined): string | null {
  const raw = Array.isArray(eventQuery) ? eventQuery[0] : eventQuery;
  if (typeof raw !== "string" || !raw.trim()) return null;
  return loginPathWithEvent(raw);
}
