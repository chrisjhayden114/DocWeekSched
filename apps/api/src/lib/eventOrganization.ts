/**
 * W-6 — an event cannot change organization after create. PUT /event used to
 * accept organizationId and silently drop it; callers could believe a transfer
 * worked. Reject the field explicitly instead.
 */

export const EVENT_ORGANIZATION_TRANSFER_ERROR = "An event can't move to a different organization.";

export function eventUpdateIncludesOrganizationId(body: unknown): boolean {
  return Boolean(
    body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      Object.prototype.hasOwnProperty.call(body, "organizationId"),
  );
}
