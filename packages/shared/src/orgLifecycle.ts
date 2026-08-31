/**
 * ORG-2 (DESIGN_PHASE_J §Org entity) — the three lifecycle acts an
 * organization was missing: hand it to someone else, close it, and move a
 * still-unpublished event out of it.
 *
 * ORG-1 left a dead end behind: a solo OWNER could not delete their account,
 * because the only guard on deletion (sole-OWNER orgs) had no route that could
 * clear it. Ownership could not be handed over and an organization could not be
 * closed, so the guard was a wall rather than a step. Everything here exists to
 * turn that wall into a door.
 *
 * Pure copy and rules, shared by API and web so the button and the route can
 * never disagree about who may act or what blocks them. No prisma, no fetch.
 */

/* ------------------------------------------------------------------ *
 * Transfer ownership
 * ------------------------------------------------------------------ */

/**
 * Only an OWNER may hand the organization over, and only to someone who is
 * already an ADMIN.
 *
 * Promote-then-transfer is two deliberate steps on purpose. A single
 * "make this person the owner" picker over the whole member list turns the most
 * consequential act in the workspace into one mis-click, and the roles already
 * carry the meaning: promoting to ADMIN says "I trust you with the workspace",
 * transferring says "it is yours now".
 */
export const ORG_TRANSFER_TARGET_ROLE = "ADMIN" as const;

export function canTransferOrgOwnership(role: string | null | undefined): boolean {
  return role === "OWNER";
}

export function isEligibleTransferTarget(role: string | null | undefined): boolean {
  return role === ORG_TRANSFER_TARGET_ROLE;
}

export const ORG_TRANSFER_TARGET_NOT_ADMIN_MESSAGE =
  "You can only hand the organization to someone who is already an admin. Promote them to admin first, then transfer.";

export const ORG_TRANSFER_TARGET_NOT_MEMBER_MESSAGE =
  "That person is not a member of this organization.";

export const ORG_TRANSFER_TO_SELF_MESSAGE = "You already own this organization.";

/** What the outgoing owner keeps. Said out loud, because it is not obvious. */
export const ORG_TRANSFER_OUTCOME_MESSAGE =
  "They become the owner and you become an admin. You keep access to every event, but only the new owner can transfer or close the organization from then on.";

export function orgTransferConfirmBody(orgName: string, newOwnerLabel: string): string {
  return `${newOwnerLabel} becomes the owner of ${orgName} and you become an admin. You keep access to every event, but only they can transfer or close the organization after this.`;
}

/* ------------------------------------------------------------------ *
 * Close the organization
 * ------------------------------------------------------------------ */

export function canCloseOrg(role: string | null | undefined): boolean {
  return role === "OWNER";
}

/**
 * Why a close was refused. Each kind is something the organizer can act on, or
 * a record that has to outlive their account — never a bare "not allowed".
 */
export type OrgCloseBlockerKind =
  | "PUBLISHED_EVENTS"
  | "PURCHASES"
  | "CERTIFICATES"
  | "AI_USAGE"
  | "ACTIVE_SUBSCRIPTION";

export type OrgCloseBlocker = {
  kind: OrgCloseBlockerKind;
  count: number;
  /** Event names for PUBLISHED_EVENTS, so the organizer knows where to go. */
  names?: string[];
};

function andList(names: string[], limit = 3): string {
  const shown = names.slice(0, limit);
  const rest = names.length - shown.length;
  const joined =
    shown.length <= 1
      ? (shown[0] ?? "")
      : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
  return rest > 0 ? `${joined} and ${rest} more` : joined;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/**
 * One line per blocker, written so the organizer knows what to do next rather
 * than only what went wrong.
 */
export function describeOrgCloseBlocker(blocker: OrgCloseBlocker): string {
  switch (blocker.kind) {
    case "PUBLISHED_EVENTS":
      return `${blocker.count} published ${plural(blocker.count, "event", "events")} — ${andList(
        blocker.names ?? [],
      )}. Archive ${plural(blocker.count, "it", "them")} first.`;
    case "PURCHASES":
      return `${blocker.count} ${plural(
        blocker.count,
        "payment is",
        "payments are",
      )} on record. Billing history has to stay reachable, so an organization that has taken money can't be closed here — transfer it instead, or write to support.`;
    case "CERTIFICATES":
      return `${blocker.count} ${plural(
        blocker.count,
        "certificate has",
        "certificates have",
      )} been issued. Attendees can still verify ${plural(
        blocker.count,
        "it",
        "them",
      )} against this organization, so it stays open — transfer it instead.`;
    case "AI_USAGE":
      return `${blocker.count} metered AI ${plural(
        blocker.count,
        "call is",
        "calls are",
      )} recorded against this organization. Usage history has to stay reachable — transfer it instead, or write to support.`;
    case "ACTIVE_SUBSCRIPTION":
      return "There is still an active subscription. Cancel it on the billing page first, so closing the organization doesn't leave a card being charged.";
  }
}

export function describeOrgCloseBlockers(blockers: OrgCloseBlocker[]): string[] {
  return blockers.map(describeOrgCloseBlocker);
}

export const ORG_CLOSE_BLOCKED_MESSAGE = "This organization still has things in it, so it can't be closed yet.";

export const ORG_CLOSE_READY_MESSAGE =
  "Nothing is left in this organization, so it can be closed. Draft and archived events stay on record but nobody will be able to open them.";

export const ORG_CLOSE_ALREADY_CLOSED_MESSAGE = "This organization is already closed.";

/**
 * Closing is not deleting, and saying otherwise would be a lie: archived events
 * hold other people's records (who attended, what they said in feedback), so
 * the rows stay. What ends is the organization's life as a workspace — it
 * leaves your console, no one can open or bill it, and it stops holding your
 * account hostage on the way out.
 */
export const ORG_CLOSE_CONSEQUENCES = [
  "The organization disappears from your console and can't be reopened by you.",
  "Draft and archived events stay on record but nobody can open or edit them again.",
  "Everyone else loses access to the workspace.",
  "It stops blocking deletion of your account.",
] as const;

export function orgCloseConfirmBody(orgName: string, otherMemberCount: number): string {
  const members =
    otherMemberCount > 0
      ? ` ${otherMemberCount} other ${plural(otherMemberCount, "member", "members")} ${plural(
          otherMemberCount,
          "loses",
          "lose",
        )} access.`
      : "";
  return `${orgName} leaves your console for good and can't be reopened by you. Draft and archived events stay on record but nobody can open them again.${members}`;
}

/**
 * The rule for every typed confirmation in the app: forgiving about case and
 * surrounding space, strict about identity. Shared so ConfirmDialog's gate and
 * the server's check cannot disagree about what counts as typed correctly.
 */
export function typedConfirmationMatches(input: string, expected: string): boolean {
  return input.trim().toLowerCase() === expected.trim().toLowerCase();
}

/**
 * Typed confirmation for close. The organization's own name, not a fixed word:
 * an organizer with several organizations has to prove which one they mean, and
 * the name is the thing they were just looking at.
 */
export function orgCloseConfirmationMatches(input: string, orgName: string): boolean {
  return typedConfirmationMatches(input, orgName);
}

export function orgCloseConfirmationLabel(orgName: string): string {
  return `Type ${orgName} to confirm`;
}

/* ------------------------------------------------------------------ *
 * Draft-only event transfer
 * ------------------------------------------------------------------ */

/**
 * Why this event cannot move.
 *
 * J-A refused a general event transfer for a concrete reason: 17 models
 * denormalize organizationId, so a naive move corrupts billing, metering and
 * audit at once. The answer is not a braver transfer — it is a transfer
 * narrow enough to be provably complete. An event that has taken money, issued
 * a certificate, burned AI credit, or joined a series has rows whose
 * organization is part of a history that must not be rewritten.
 */
export type EventTransferBlockerKind =
  | "NOT_DRAFT"
  | "PURCHASES"
  | "CERTIFICATES"
  | "AI_USAGE"
  | "SERIES";

export type EventTransferBlocker = {
  kind: EventTransferBlockerKind;
  count: number;
  /** UI status for NOT_DRAFT ("Published", "Archived"), series name for SERIES. */
  detail?: string;
};

export function describeEventTransferBlocker(blocker: EventTransferBlocker): string {
  switch (blocker.kind) {
    case "NOT_DRAFT":
      return `The event is ${blocker.detail ?? "published"}. Only a draft can move — once an event is live its attendees, invites and billing are attached to this organization.`;
    case "PURCHASES":
      return `${blocker.count} ${plural(
        blocker.count,
        "payment is",
        "payments are",
      )} recorded against this event, and payments belong to the organization that took them.`;
    case "CERTIFICATES":
      return `${blocker.count} ${plural(
        blocker.count,
        "certificate has",
        "certificates have",
      )} been issued, and each one names this organization as the issuer.`;
    case "AI_USAGE":
      return `${blocker.count} metered AI ${plural(
        blocker.count,
        "call is",
        "calls are",
      )} billed to this organization.`;
    case "SERIES":
      return `The event belongs to the series ${
        blocker.detail ?? "it was created in"
      }, which lives in this organization. Series carry a price lock, so a member event can't leave on its own.`;
  }
}

export function describeEventTransferBlockers(blockers: EventTransferBlocker[]): string[] {
  return blockers.map(describeEventTransferBlocker);
}

/**
 * The honest recommendation when a transfer is refused. There is a way to get
 * the program into the other organization; it just isn't a database move.
 */
export const EVENT_TRANSFER_RECOMMENDATION =
  "Create the event in the other organization and re-import your program there — the importer recognizes revised sessions, so you keep the agenda you built.";

export const EVENT_TRANSFER_BLOCKED_MESSAGE = "This event can't move to another organization.";

export const EVENT_TRANSFER_READY_MESSAGE =
  "This event is still a draft with nothing attached to it, so it can move to another organization.";

export const EVENT_TRANSFER_SAME_ORG_MESSAGE = "This event is already in that organization.";

export const EVENT_TRANSFER_TARGET_ROLE_MESSAGE =
  "You need to be an owner or admin of the organization you're moving the event into.";

export function eventTransferConfirmBody(eventName: string, targetOrgName: string): string {
  return `${eventName} moves to ${targetOrgName}. From then on ${targetOrgName} hosts it, is billed for it, and its plan sets the limits. Only a draft can move, so nothing an attendee can see changes.`;
}

/** Shown in the create-event wizard and event settings, in place of ORG-1's flat "never". */
export const EVENT_ORG_MOVE_NOTE =
  "You can move an event to another organization while it is still a draft. Once it is published it stays where it is.";

/** Labels for the draft-only move section in Event settings. */
export const EVENT_TRANSFER_UI = {
  heading: "Move to another organization",
  intro:
    "While this event is a draft you can move it to another organization you run. The new organization becomes the host, is billed for it, and its plan sets the limits.",
  pickerLabel: "Move to",
  choosePlaceholder: "Choose an organization…",
  action: "Move event",
  working: "Moving…",
  blockedHeading: "Why it can't move",
  confirmTitle: "Move this event?",
  confirmLabel: "Move it",
  cancelLabel: "Keep it here",
} as const;
