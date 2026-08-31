/**
 * W-6 — event-creation org picker. A single-org user never sees a one-option
 * dropdown, and the picker says what choosing here commits to.
 *
 * ORG-2 replaced W-6's flat "an event can't move" with the truth: a draft can
 * move, a published event cannot. The old note was correct about the case that
 * matters (by the time it matters, the event is usually live) but wrong as
 * stated, and a picker that overstates the stakes teaches people to distrust it.
 */

export const EVENT_ORG_LOCKED_NOTE =
  "You can move an event while it's still a draft. Once it's published it stays with this organization.";

export type EventCreationOrgMode =
  | { kind: "none" }
  | { kind: "single"; name: string }
  | { kind: "picker"; note: string };

export function eventCreationOrgMode(orgs: { id: string; name: string }[]): EventCreationOrgMode {
  if (orgs.length === 0) return { kind: "none" };
  if (orgs.length === 1) return { kind: "single", name: orgs[0]!.name };
  return { kind: "picker", note: EVENT_ORG_LOCKED_NOTE };
}
