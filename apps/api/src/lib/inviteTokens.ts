import { createHash, randomBytes } from "crypto";
import { prisma } from "./db";
import { generateOpaqueToken, hashToken } from "./auth";
import { env } from "./env";
import { ensureUniqueEventSlug, slugifyEventBase } from "./slug";

export function inviteExpiresAt(from = new Date()): Date {
  return new Date(from.getTime() + env.inviteTokenDays * 24 * 60 * 60 * 1000);
}

export function newInviteToken(): { raw: string; hash: string; expiresAt: Date } {
  const raw = generateOpaqueToken(32);
  return { raw, hash: hashToken(raw), expiresAt: inviteExpiresAt() };
}

export function newJoinToken(): { raw: string; hash: string } {
  const raw = generateOpaqueToken(24);
  return { raw, hash: hashToken(raw) };
}

/** Ensure event has a join token; returns raw token only when freshly minted. */
export async function ensureEventJoinToken(eventId: string): Promise<{ raw: string | null; created: boolean }> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { joinTokenHash: true, joinTokenRevokedAt: true },
  });
  if (!event) return { raw: null, created: false };
  if (event.joinTokenHash && !event.joinTokenRevokedAt) {
    return { raw: null, created: false };
  }
  const { raw, hash } = newJoinToken();
  await prisma.event.update({
    where: { id: eventId },
    data: {
      joinTokenHash: hash,
      joinTokenRevokedAt: null,
      joinTokenUseCount: 0,
      joinTokenExpiresAt: null,
      joinTokenCapacity: null,
    },
  });
  return { raw, created: true };
}

export async function regenerateJoinToken(eventId: string): Promise<string> {
  const { raw, hash } = newJoinToken();
  await prisma.event.update({
    where: { id: eventId },
    data: {
      joinTokenHash: hash,
      joinTokenRevokedAt: null,
      joinTokenUseCount: 0,
    },
  });
  return raw;
}

export async function regenerateSlug(eventId: string, preferredBase?: string): Promise<string> {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { name: true, slug: true } });
  if (!event) throw new Error("Event not found");
  const base = preferredBase?.trim() || `${slugifyEventBase(event.name)}-${randomBytes(3).toString("hex")}`;
  const slug = await ensureUniqueEventSlug(slugifyEventBase(base) || `event-${randomBytes(3).toString("hex")}`, eventId);
  await prisma.event.update({
    where: { id: eventId },
    data: {
      slug,
      slugInviteEnabled: true,
      slugInviteUseCount: 0,
    },
  });
  return slug;
}

export function isJoinLinkActive(event: {
  joinTokenHash: string | null;
  joinTokenRevokedAt: Date | null;
  joinTokenExpiresAt: Date | null;
  joinTokenCapacity: number | null;
  joinTokenUseCount: number;
}): boolean {
  if (!event.joinTokenHash || event.joinTokenRevokedAt) return false;
  if (event.joinTokenExpiresAt && event.joinTokenExpiresAt.getTime() < Date.now()) return false;
  if (event.joinTokenCapacity != null && event.joinTokenUseCount >= event.joinTokenCapacity) return false;
  return true;
}

export function isSlugLinkActive(event: {
  slugInviteEnabled: boolean;
  slugInviteExpiresAt: Date | null;
  slugInviteCapacity: number | null;
  slugInviteUseCount: number;
}): boolean {
  if (!event.slugInviteEnabled) return false;
  if (event.slugInviteExpiresAt && event.slugInviteExpiresAt.getTime() < Date.now()) return false;
  if (event.slugInviteCapacity != null && event.slugInviteUseCount >= event.slugInviteCapacity) return false;
  return true;
}

/** Deterministic hash helper exported for tests. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
