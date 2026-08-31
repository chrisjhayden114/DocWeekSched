/**
 * W-6 — an event cannot change organization on a settings save. PUT /event used
 * to accept organizationId and silently drop it; callers could believe a
 * transfer worked. Reject the field explicitly instead.
 *
 * ORG-2 did not soften this. A general transfer still has to rewrite every one
 * of the seventeen models that denormalize organizationId, which is safe only
 * for a draft with nothing attached — so that case got its own route,
 * POST /event/transfer-organization, with its own eligibility check. A field
 * riding along on a settings save is still not a transfer.
 */

export const EVENT_ORGANIZATION_TRANSFER_ERROR =
  "An event can't move to a different organization by saving its settings. While it is still a draft, use Move to another organization in Event settings.";

export function eventUpdateIncludesOrganizationId(body: unknown): boolean {
  return Boolean(
    body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      Object.prototype.hasOwnProperty.call(body, "organizationId"),
  );
}
