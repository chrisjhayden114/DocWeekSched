import { generateOpaqueToken, hashToken } from "../auth";

/** O1 — portal tokens expire 30 days from mint/remint. */
export const PORTAL_TOKEN_DAYS = 30;

export type PortalTokenDenial = "unknown" | "expired" | "revoked";

export function portalExpiresAt(from = new Date()): Date {
  return new Date(from.getTime() + PORTAL_TOKEN_DAYS * 24 * 60 * 60 * 1000);
}

export function newPortalToken(from = new Date()): { raw: string; hash: string; expiresAt: Date } {
  const raw = generateOpaqueToken(32);
  return { raw, hash: hashToken(raw), expiresAt: portalExpiresAt(from) };
}

export function hashPortalToken(raw: string): string {
  return hashToken(raw);
}

export function evaluatePortalAccess(
  row: { expiresAt: Date; revokedAt: Date | null } | null,
  now = new Date(),
): { ok: true } | { ok: false; reason: PortalTokenDenial } {
  if (!row) return { ok: false, reason: "unknown" };
  if (row.revokedAt) return { ok: false, reason: "revoked" };
  if (row.expiresAt.getTime() < now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true };
}

/** ER5.1 — which of the two stored hashes a presenter's raw token matched. */
export type PortalTokenSlot = "current" | "previous";

export type PortalTokenSlots = {
  tokenHash: string;
  expiresAt: Date;
  previousTokenHash: string | null;
  previousExpiresAt: Date | null;
  revokedAt: Date | null;
};

/**
 * ER5.1 — a presenter's link is valid if it matches EITHER stored hash.
 *
 * Presenters bookmark the email they happen to have open, so a remint must not
 * turn an older email into a dead end. The previous slot is honored on its own
 * original expiry — grace never extends a clock, it only declines to smash one.
 * Revocation is checked first and covers both slots: revoked is revoked.
 */
export function matchPortalToken(
  row: PortalTokenSlots | null,
  hash: string,
  now = new Date(),
): { ok: true; slot: PortalTokenSlot } | { ok: false; reason: PortalTokenDenial } {
  if (!row) return { ok: false, reason: "unknown" };
  if (row.revokedAt) return { ok: false, reason: "revoked" };
  if (row.tokenHash === hash) {
    if (row.expiresAt.getTime() < now.getTime()) return { ok: false, reason: "expired" };
    return { ok: true, slot: "current" };
  }
  if (row.previousTokenHash && row.previousTokenHash === hash) {
    if (!row.previousExpiresAt || row.previousExpiresAt.getTime() < now.getTime()) {
      return { ok: false, reason: "expired" };
    }
    return { ok: true, slot: "previous" };
  }
  return { ok: false, reason: "unknown" };
}

/**
 * ER5.1 — the remint write: the outgoing token slides into the grace slot
 * carrying its ORIGINAL expiry, and whatever was in that slot falls off. Only
 * one older link is ever alive, so a second remint retires the oldest.
 *
 * A revoked row passes `keepGrace: false`: its current token is dead and must
 * not be resurrected by the remint that clears `revokedAt`.
 */
export function portalRemintData(
  current: { tokenHash: string; expiresAt: Date },
  next: { hash: string; expiresAt: Date },
  keepGrace = true,
): {
  tokenHash: string;
  expiresAt: Date;
  previousTokenHash: string | null;
  previousExpiresAt: Date | null;
} {
  return {
    tokenHash: next.hash,
    expiresAt: next.expiresAt,
    previousTokenHash: keepGrace ? current.tokenHash : null,
    previousExpiresAt: keepGrace ? current.expiresAt : null,
  };
}

/** ER5.1 — revoke empties the grace slot; revocation covers every link ever sent. */
export const CLEARED_GRACE_SLOT = {
  previousTokenHash: null,
  previousExpiresAt: null,
} as const;

export function portalDenialMessage(reason: PortalTokenDenial): string {
  if (reason === "expired") {
    return "This link has expired — contact the event organizer for a fresh one.";
  }
  if (reason === "revoked") {
    return "This link is no longer valid — contact the event organizer for a fresh one.";
  }
  return "This link is not valid — contact the event organizer for a fresh one.";
}
