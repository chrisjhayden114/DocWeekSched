/**
 * W-6 — event-creation org picker. An event is born in one organization and
 * cannot move; the picker is honest about that, and a single-org user never
 * sees a one-option dropdown.
 */

export const EVENT_ORG_LOCKED_NOTE = "An event can't move to a different organization later.";

export type EventCreationOrgMode =
  | { kind: "none" }
  | { kind: "single"; name: string }
  | { kind: "picker"; note: string };

export function eventCreationOrgMode(orgs: { id: string; name: string }[]): EventCreationOrgMode {
  if (orgs.length === 0) return { kind: "none" };
  if (orgs.length === 1) return { kind: "single", name: orgs[0]!.name };
  return { kind: "picker", note: EVENT_ORG_LOCKED_NOTE };
}
