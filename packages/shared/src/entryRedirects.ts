/** Entry-flow redirect helpers (Phase 6). Pure — safe for web + unit tests. */

/** Build the login URL that preserves an event slug/token query. */
export function loginPathWithEvent(event: string): string {
  const trimmed = event.trim();
  return `/login?event=${encodeURIComponent(trimmed)}`;
}

/**
 * AGENDA-1 — where the public agenda's "Full details" sends a visitor who has
 * no account yet: sign in against this event, then land on the session page
 * they actually asked for.
 */
export function loginPathForSession(event: string, sessionId: string): string {
  const next = `/session/${encodeURIComponent(sessionId)}`;
  return `${loginPathWithEvent(event)}&intent=join&next=${encodeURIComponent(next)}`;
}

/**
 * Sanitize a `?next=` destination before redirecting to it. Only same-origin
 * absolute paths survive: a bare "/path", never "//host" (protocol-relative,
 * i.e. off-site) and never a scheme.
 */
export function safeNextPath(raw: string | string[] | null | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  if (/[\u0000-\u001f]/.test(trimmed)) return null;
  return trimmed;
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
