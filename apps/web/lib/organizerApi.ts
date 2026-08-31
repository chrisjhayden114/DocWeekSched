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
  /** ORG-2 — set once the organization has been closed for good. */
  closedAt?: string | null;
};

/* ------------------------------------------------------------------ *
 * ORG-2 — organization lifecycle (danger zone + draft event transfer)
 * ------------------------------------------------------------------ */

export type OrgMember = {
  userId: string;
  name: string | null;
  email: string;
  role: string;
  isSelf: boolean;
};

export async function listOrgMembers(orgId: string) {
  return apiFetch<{ members: OrgMember[]; transferTargetRole: string }>(
    `/organizations/${encodeURIComponent(orgId)}/members`,
  );
}

export async function transferOrgOwnership(orgId: string, newOwnerUserId: string) {
  return apiFetch<{ ok: true; newOwnerUserId: string; yourRole: string; message: string }>(
    `/organizations/${encodeURIComponent(orgId)}/transfer-ownership`,
    { method: "POST", body: JSON.stringify({ newOwnerUserId }) },
  );
}

export type OrgCloseState = {
  organizationId: string;
  name: string;
  closedAt: string | null;
  canClose: boolean;
  blockers: Array<{ kind: string; count: number; names?: string[] }>;
  /** One human sentence per blocker, rendered as-is. */
  reasons: string[];
  draftEventCount: number;
  archivedEventCount: number;
  otherMemberCount: number;
};

export async function getOrgCloseState(orgId: string) {
  return apiFetch<OrgCloseState>(`/organizations/${encodeURIComponent(orgId)}/close`);
}

/** `confirmName` is the typed organization name; the server checks it too. */
export async function closeOrg(orgId: string, confirmName: string) {
  return apiFetch<{ ok: true; closedAt: string; message: string }>(
    `/organizations/${encodeURIComponent(orgId)}/close`,
    { method: "POST", body: JSON.stringify({ confirmName }) },
  );
}

export type EventTransferState = {
  eventId: string;
  canTransfer: boolean;
  blockers: Array<{ kind: string; count: number; detail?: string }>;
  reasons: string[];
  recommendation: string | null;
  currentOrganizationId: string;
  targets: Array<{ id: string; name: string; role: string }>;
};

export async function getEventTransferState(eventId: string) {
  return organizerFetch<EventTransferState>("/event/transfer-organization", eventId);
}

export async function transferEventOrganization(eventId: string, organizationId: string) {
  return organizerFetch<{ ok: true; organizationId: string; message: string }>(
    "/event/transfer-organization",
    eventId,
    { method: "POST", body: JSON.stringify({ organizationId }) },
  );
}

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
