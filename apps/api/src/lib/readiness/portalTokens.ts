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

export function portalDenialMessage(reason: PortalTokenDenial): string {
  if (reason === "expired") {
    return "This link has expired — contact the event organizer for a fresh one.";
  }
  if (reason === "revoked") {
    return "This link is no longer valid — contact the event organizer for a fresh one.";
  }
  return "This link is not valid — contact the event organizer for a fresh one.";
}
