import { NotificationKind, Prisma, SessionJoinMode } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../authorization";
import { notifyMany } from "../notifications";
import { sendWaitlistPromotedEmail } from "../mail";
import { env } from "../env";

export type CapacityMode = "IN_PERSON" | "VIRTUAL";

export const WAITLIST_SEAT_HOLD_HOURS = Number(process.env.WAITLIST_SEAT_HOLD_HOURS || 24);

export type PromotionNotify = {
  userId: string;
  email: string;
  name: string;
  eventId: string;
  sessionTitle: string;
  mode: CapacityMode;
  holdExpiresAt: Date;
};

export function isCapacityMode(mode: string | null | undefined): mode is CapacityMode {
  return mode === "IN_PERSON" || mode === "VIRTUAL";
}

export function capacityForMode(
  session: { inPersonCapacity: number | null; virtualCapacity: number | null },
  mode: CapacityMode,
): number | null {
  return mode === "IN_PERSON" ? session.inPersonCapacity : session.virtualCapacity;
}

export async function countJoining(
  tx: Prisma.TransactionClient,
  sessionId: string,
  mode: CapacityMode,
): Promise<number> {
  return tx.sessionAttendance.count({
    where: { sessionId, status: "JOINING", joinMode: mode },
  });
}

async function nextWaitlistPosition(
  tx: Prisma.TransactionClient,
  sessionId: string,
  mode: CapacityMode,
): Promise<number> {
  const agg = await tx.waitlistEntry.aggregate({
    where: { sessionId, mode },
    _max: { position: true },
  });
  return (agg._max.position ?? 0) + 1;
}

export async function resequenceWaitlist(
  tx: Prisma.TransactionClient,
  sessionId: string,
  mode: CapacityMode,
): Promise<void> {
  const rows = await tx.waitlistEntry.findMany({
    where: { sessionId, mode },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  for (let i = 0; i < rows.length; i += 1) {
    const pos = i + 1;
    if (rows[i].position !== pos) {
      await tx.waitlistEntry.update({ where: { id: rows[i].id }, data: { position: pos } });
    }
  }
}

export type JoinResult =
  | { kind: "joined"; attendanceId: string }
  | {
      kind: "waitlisted";
      position: number;
      capacity: number;
      current: number;
      message: string;
    };

export async function dispatchPromotionNotify(n: PromotionNotify): Promise<void> {
  const label = n.mode === "IN_PERSON" ? "in person" : "virtual";
  const hours = WAITLIST_SEAT_HOLD_HOURS;
  await notifyMany([
    {
      userId: n.userId,
      eventId: n.eventId,
      kind: NotificationKind.WAITLIST_PROMOTED,
      title: `A seat opened: ${n.sessionTitle}`,
      body: `You're offered a ${label} seat. Confirm within ${hours}h (hold until ${n.holdExpiresAt.toISOString()}).`,
    },
  ]);
  const base = env.webBaseUrl.replace(/\/$/, "");
  await sendWaitlistPromotedEmail({
    to: n.email,
    name: n.name,
    sessionTitle: n.sessionTitle,
    modeLabel: label,
    holdHours: hours,
    holdExpiresAt: n.holdExpiresAt,
    agendaUrl: `${base}/dashboard`,
  }).catch(() => undefined);
}

/**
 * Race-safe join or waitlist. Locks the Session row with FOR UPDATE.
 */
export async function joinSessionOrWaitlist(params: {
  sessionId: string;
  userId: string;
  mode: SessionJoinMode;
}): Promise<JoinResult> {
  const { sessionId, userId, mode } = params;

  if (mode === "ASYNC") {
    const row = await prisma.sessionAttendance.upsert({
      where: { userId_sessionId: { userId, sessionId } },
      update: { status: "JOINING", joinMode: "ASYNC" },
      create: { userId, sessionId, status: "JOINING", joinMode: "ASYNC" },
    });
    await prisma.waitlistEntry.deleteMany({ where: { sessionId, userId } });
    return { kind: "joined", attendanceId: row.id };
  }

  if (!isCapacityMode(mode)) {
    throw new HttpError(400, { error: "Invalid join mode" });
  }

  return prisma.$transaction(async (tx) => {
    await expireHoldsInTx(tx, sessionId);

    const locked = await tx.$queryRaw<
      Array<{
        id: string;
        allowVirtualJoin: boolean;
        inPersonCapacity: number | null;
        virtualCapacity: number | null;
        eventId: string;
        title: string;
      }>
    >`SELECT id, "allowVirtualJoin", "inPersonCapacity", "virtualCapacity", "eventId", title
      FROM "Session" WHERE id = ${sessionId} FOR UPDATE`;

    const session = locked[0];
    if (!session) throw new HttpError(404, { error: "Session not found" });

    if (mode === "VIRTUAL" && session.allowVirtualJoin === false) {
      throw new HttpError(400, { error: "Virtual joining is not available for this session" });
    }

    const cap = capacityForMode(session, mode);
    const current = await countJoining(tx, sessionId, mode);

    const promotedHold = await tx.waitlistEntry.findFirst({
      where: {
        sessionId,
        userId,
        mode,
        promotedAt: { not: null },
        holdExpiresAt: { gt: new Date() },
      },
    });

    if (cap == null || current < cap || promotedHold) {
      const row = await tx.sessionAttendance.upsert({
        where: { userId_sessionId: { userId, sessionId } },
        update: { status: "JOINING", joinMode: mode },
        create: { userId, sessionId, status: "JOINING", joinMode: mode },
      });
      await tx.waitlistEntry.deleteMany({ where: { sessionId, userId } });
      return { kind: "joined", attendanceId: row.id };
    }

    const existing = await tx.waitlistEntry.findUnique({
      where: { sessionId_userId: { sessionId, userId } },
    });
    let position: number;
    if (existing) {
      if (existing.mode !== mode) {
        const oldMode = existing.mode;
        await tx.waitlistEntry.update({
          where: { id: existing.id },
          data: {
            mode,
            position: await nextWaitlistPosition(tx, sessionId, mode),
            promotedAt: null,
            holdExpiresAt: null,
          },
        });
        if (isCapacityMode(oldMode)) await resequenceWaitlist(tx, sessionId, oldMode);
      }
      const refreshed = await tx.waitlistEntry.findUniqueOrThrow({ where: { id: existing.id } });
      position = refreshed.position;
    } else {
      position = await nextWaitlistPosition(tx, sessionId, mode);
      await tx.waitlistEntry.create({
        data: { sessionId, userId, mode, position },
      });
    }

    await tx.sessionAttendance.upsert({
      where: { userId_sessionId: { userId, sessionId } },
      update: { status: "NOT_JOINING", joinMode: null },
      create: { userId, sessionId, status: "NOT_JOINING", joinMode: null },
    });

    const label = mode === "IN_PERSON" ? "in person" : "virtual";
    return {
      kind: "waitlisted",
      position,
      capacity: cap,
      current: cap,
      message: `This session is full (${cap}/${cap} ${label}). Join the waitlist — you're #${position}.`,
    };
  });
}

export async function leaveSessionAttendance(params: {
  sessionId: string;
  userId: string;
}): Promise<{ promotedUserId: string | null; notify: PromotionNotify | null }> {
  const { sessionId, userId } = params;

  const result = await prisma.$transaction(async (tx) => {
    const notifies: PromotionNotify[] = [];
    await expireHoldsInTx(tx, sessionId, notifies);

    const locked = await tx.$queryRaw<
      Array<{ id: string; eventId: string; title: string }>
    >`SELECT id, "eventId", title FROM "Session" WHERE id = ${sessionId} FOR UPDATE`;
    const session = locked[0];
    if (!session) throw new HttpError(404, { error: "Session not found" });

    const prior = await tx.sessionAttendance.findUnique({
      where: { userId_sessionId: { userId, sessionId } },
    });
    const freedMode =
      prior?.status === "JOINING" && isCapacityMode(prior.joinMode) ? prior.joinMode : null;

    await tx.sessionAttendance.upsert({
      where: { userId_sessionId: { userId, sessionId } },
      update: { status: "NOT_JOINING", joinMode: null },
      create: { userId, sessionId, status: "NOT_JOINING", joinMode: null },
    });
    await tx.waitlistEntry.deleteMany({ where: { sessionId, userId } });

    let promotedUserId: string | null = null;
    let notify: PromotionNotify | null = null;
    if (freedMode) {
      const promo = await promoteNextInTx(tx, {
        sessionId,
        mode: freedMode,
        eventId: session.eventId,
        sessionTitle: session.title,
      });
      if (promo) {
        promotedUserId = promo.userId;
        notify = promo;
        notifies.push(promo);
      }
    }
    return { promotedUserId, notify, notifies };
  });

  for (const n of result.notifies) {
    await dispatchPromotionNotify(n);
  }
  return { promotedUserId: result.promotedUserId, notify: result.notify };
}

export async function promoteNextInTx(
  tx: Prisma.TransactionClient,
  params: { sessionId: string; mode: CapacityMode; eventId: string; sessionTitle: string },
): Promise<PromotionNotify | null> {
  const pendingHold = await tx.waitlistEntry.findFirst({
    where: {
      sessionId: params.sessionId,
      mode: params.mode,
      promotedAt: { not: null },
      holdExpiresAt: { gt: new Date() },
    },
  });
  if (pendingHold) return null;

  const next = await tx.waitlistEntry.findFirst({
    where: {
      sessionId: params.sessionId,
      mode: params.mode,
      promotedAt: null,
    },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: { user: { select: { id: true, email: true, name: true } } },
  });
  if (!next) return null;

  const holdExpiresAt = new Date(Date.now() + WAITLIST_SEAT_HOLD_HOURS * 60 * 60 * 1000);
  await tx.waitlistEntry.update({
    where: { id: next.id },
    data: { promotedAt: new Date(), holdExpiresAt },
  });

  return {
    userId: next.userId,
    email: next.user.email,
    name: next.user.name,
    eventId: params.eventId,
    sessionTitle: params.sessionTitle,
    mode: params.mode,
    holdExpiresAt,
  };
}

export async function manualPromoteEntry(entryId: string): Promise<void> {
  const notify = await prisma.$transaction(async (tx) => {
    const entry = await tx.waitlistEntry.findUnique({
      where: { id: entryId },
      include: {
        session: { select: { id: true, eventId: true, title: true } },
        user: { select: { id: true, email: true, name: true } },
      },
    });
    if (!entry) throw new HttpError(404, { error: "Waitlist entry not found" });
    if (!isCapacityMode(entry.mode)) throw new HttpError(400, { error: "Invalid mode" });

    await tx.$queryRaw`SELECT id FROM "Session" WHERE id = ${entry.sessionId} FOR UPDATE`;
    const notifies: PromotionNotify[] = [];
    await expireHoldsInTx(tx, entry.sessionId, notifies);

    // Clear other active holds for this mode so manual promote wins
    await tx.waitlistEntry.updateMany({
      where: {
        sessionId: entry.sessionId,
        mode: entry.mode,
        promotedAt: { not: null },
        id: { not: entry.id },
      },
      data: { promotedAt: null, holdExpiresAt: null },
    });

    const holdExpiresAt = new Date(Date.now() + WAITLIST_SEAT_HOLD_HOURS * 60 * 60 * 1000);
    await tx.waitlistEntry.update({
      where: { id: entry.id },
      data: { promotedAt: new Date(), holdExpiresAt },
    });

    const n: PromotionNotify = {
      userId: entry.userId,
      email: entry.user.email,
      name: entry.user.name,
      eventId: entry.session.eventId,
      sessionTitle: entry.session.title,
      mode: entry.mode,
      holdExpiresAt,
    };
    notifies.push(n);
    return notifies;
  });

  for (const n of notify) {
    await dispatchPromotionNotify(n);
  }
}

export async function removeWaitlistEntry(entryId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const entry = await tx.waitlistEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new HttpError(404, { error: "Waitlist entry not found" });
    await tx.$queryRaw`SELECT id FROM "Session" WHERE id = ${entry.sessionId} FOR UPDATE`;
    const mode = entry.mode;
    await tx.waitlistEntry.delete({ where: { id: entryId } });
    if (isCapacityMode(mode)) {
      await resequenceWaitlist(tx, entry.sessionId, mode);
    }
  });
}

export async function expireHoldsInTx(
  tx: Prisma.TransactionClient,
  sessionId?: string,
  outNotifies?: PromotionNotify[],
): Promise<number> {
  const now = new Date();
  const expired = await tx.waitlistEntry.findMany({
    where: {
      promotedAt: { not: null },
      holdExpiresAt: { lte: now },
      ...(sessionId ? { sessionId } : {}),
    },
    include: {
      session: { select: { id: true, eventId: true, title: true } },
    },
  });

  let promoted = 0;
  for (const row of expired) {
    if (!isCapacityMode(row.mode)) continue;
    const attending = await tx.sessionAttendance.findUnique({
      where: { userId_sessionId: { userId: row.userId, sessionId: row.sessionId } },
    });
    if (attending?.status === "JOINING" && attending.joinMode === row.mode) {
      await tx.waitlistEntry.delete({ where: { id: row.id } });
      await resequenceWaitlist(tx, row.sessionId, row.mode);
      continue;
    }

    await tx.waitlistEntry.delete({ where: { id: row.id } });
    await resequenceWaitlist(tx, row.sessionId, row.mode);
    const next = await promoteNextInTx(tx, {
      sessionId: row.sessionId,
      mode: row.mode,
      eventId: row.session.eventId,
      sessionTitle: row.session.title,
    });
    if (next) {
      promoted += 1;
      outNotifies?.push(next);
    }
  }
  return promoted;
}

export async function expireAllHolds(): Promise<number> {
  const notifies: PromotionNotify[] = [];
  const count = await prisma.$transaction((tx) => expireHoldsInTx(tx, undefined, notifies));
  for (const n of notifies) {
    await dispatchPromotionNotify(n);
  }
  return count;
}

export async function listWaitlist(sessionId: string) {
  return prisma.waitlistEntry.findMany({
    where: { sessionId },
    orderBy: [{ mode: "asc" }, { position: "asc" }],
    include: {
      user: { select: { id: true, name: true, email: true, photoUrl: true } },
    },
  });
}
