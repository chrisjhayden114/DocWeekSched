import { apiFetch } from "./api";

export function eventHeaders(eventId: string, extra?: RequestInit): RequestInit {
  return {
    ...extra,
    headers: {
      ...(extra?.headers as Record<string, string> | undefined),
      "x-event-id": eventId,
    },
  };
}

export async function organizerFetch<T>(path: string, eventId: string | null, options: RequestInit = {}) {
  const opts = eventId ? eventHeaders(eventId, options) : options;
  return apiFetch<T>(path, opts);
}

export type OrgSummary = {
  id: string;
  name: string;
  slug: string;
  role: string;
  eventCount: number;
};

/**
 * ORG-1 — the organization's own identity, from GET/PUT /organizations/:orgId.
 * `role` is the caller's membership role; only OWNER/ADMIN may save.
 */
export type OrgIdentity = {
  id: string;
  name: string;
  slug: string;
  websiteUrl: string | null;
  supportEmail: string | null;
  logoUrl: string | null;
  description: string | null;
  role?: string;
};

export type OrganizerEvent = {
  id: string;
  name: string;
  slug: string;
  status: string;
  uiStatus: string;
  startDate: string;
  endDate: string;
  timezone: string;
  brandColor?: string | null;
  description?: string | null;
  seriesId?: string | null;
};
