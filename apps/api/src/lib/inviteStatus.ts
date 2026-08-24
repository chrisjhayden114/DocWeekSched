/**
 * W-2 — the roster's invite status, derived (no status column to drift).
 *
 * Three of the four states come from the user's profile-setup token, exactly
 * as they did before W-2. NOT_INVITED is the new one: a real roster seat that
 * has never been emailed, which is what POST /attendees/import creates.
 *
 * Why a per-membership marker is needed: the setup token lives on User and is
 * global, so it cannot say "this person has never been told about THIS event".
 * EventMembership.addedWithoutInviteAt is set when a seat is created without
 * an invite and cleared the moment one is sent. It is null on every row that
 * existed before W-2, so those rows derive exactly the status they did before.
 */

export type InviteStatus = "ACTIVE" | "PENDING_SETUP" | "INVITE_EXPIRED" | "NOT_INVITED";

export type InviteStatusInput = {
  /** User.profileSetupTokenHash — non-null means an invite is outstanding. */
  profileSetupTokenHash?: string | null;
  profileSetupTokenExpiresAt?: Date | null;
  /** EventMembership.addedWithoutInviteAt — non-null means no invite was ever sent. */
  addedWithoutInviteAt?: Date | null;
};

export function deriveInviteStatus(input: InviteStatusInput, now: Date = new Date()): InviteStatus {
  const pending = input.profileSetupTokenHash != null;
  if (pending) {
    const expiresAt = input.profileSetupTokenExpiresAt;
    return expiresAt != null && expiresAt.getTime() < now.getTime()
      ? "INVITE_EXPIRED"
      : "PENDING_SETUP";
  }
  // No outstanding token: either they finished setup (ACTIVE) or they were
  // added to the roster and never emailed (NOT_INVITED).
  return input.addedWithoutInviteAt != null ? "NOT_INVITED" : "ACTIVE";
}

/** An invite is worth sending unless the person has already finished setup. */
export function needsInvite(status: InviteStatus): boolean {
  return status !== "ACTIVE";
}
