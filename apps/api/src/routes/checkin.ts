/**
 * Phase 5 — Check-in (self, staff, QR) with offline sync support.
 * QR payload = EventMembership.checkInCode (cuid, already on every membership).
 */

import { Router } from "express";
import { z } from "zod";
import { CheckInMethod } from "@prisma/client";
import { asyncHandler, HttpError, requireEventAccess } from "../lib/authorization";
import { prisma } from "../lib/db";
import { resolveEventFromRequest } from "../lib/requestEvent";
import { requireAuth, requireCsrf, AuthedRequest } from "../lib/middleware";
import { requireFeature } from "../lib/features";
import { validationErrorBody } from "../lib/errors";

export const checkinRouter = Router();

checkinRouter.get(
  "/me/code",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id);
    await requireFeature(event.id, "checkin");

    const m = await prisma.eventMembership.findFirst({
      where: { eventId: event.id, userId: req.user!.id, deletedAt: null },
      select: { checkInCode: true },
    });
    if (!m) throw new HttpError(404, { error: "Not a member of this event" });

    const checkedIn = await prisma.checkIn.findUnique({
      where: { userId_eventId: { userId: req.user!.id, eventId: event.id } },
    });

    return res.json({
      checkInCode: m.checkInCode,
      /** Clients encode this string as the QR payload — do not invent a separate code. */
      qrPayload: m.checkInCode,
      checkedIn: Boolean(checkedIn),
      checkedInAt: checkedIn?.createdAt ?? null,
    });
  }),
);

checkinRouter.get(
  "/roster",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    await requireFeature(event.id, "checkin");

    const members = await prisma.eventMembership.findMany({
      where: { eventId: event.id, deletedAt: null },
      select: {
        checkInCode: true,
        userId: true,
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { user: { name: "asc" } },
    });
    const checkIns = await prisma.checkIn.findMany({
      where: { eventId: event.id },
      select: { userId: true, createdAt: true, method: true },
    });
    const byUser = new Map(checkIns.map((c) => [c.userId, c]));

    return res.json({
      eventId: event.id,
      generatedAt: new Date().toISOString(),
      attendees: members.map((m) => ({
        userId: m.userId,
        name: m.user.name,
        email: m.user.email,
        checkInCode: m.checkInCode,
        checkedIn: byUser.has(m.userId),
        checkedInAt: byUser.get(m.userId)?.createdAt ?? null,
        method: byUser.get(m.userId)?.method ?? null,
      })),
      checkedInCount: checkIns.length,
      totalCount: members.length,
    });
  }),
);

checkinRouter.post(
  "/",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id);
    await requireFeature(event.id, "checkin");

    const checkIn = await prisma.checkIn.upsert({
      where: { userId_eventId: { userId: req.user!.id, eventId: event.id } },
      update: {},
      create: {
        userId: req.user!.id,
        eventId: event.id,
        method: CheckInMethod.SELF,
      },
    });

    return res.json(checkIn);
  }),
);

const staffScanSchema = z.object({
  /** Prefer checkInCode (QR payload). userId accepted for roster tap. */
  checkInCode: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
  clientMutationId: z.string().min(8).max(64).optional(),
  method: z.enum(["STAFF_SCAN", "QR_SCAN"]).optional(),
});

checkinRouter.post(
  "/scan",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = staffScanSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationErrorBody(parsed.error));
    if (!parsed.data.checkInCode && !parsed.data.userId) {
      return res.status(400).json({ error: "checkInCode or userId required" });
    }

    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    await requireFeature(event.id, "checkin");

    if (parsed.data.clientMutationId) {
      const existing = await prisma.checkIn.findFirst({
        where: { clientMutationId: parsed.data.clientMutationId },
      });
      if (existing) {
        return res.json({ ...existing, idempotentReplay: true });
      }
    }

    const membership = await prisma.eventMembership.findFirst({
      where: {
        eventId: event.id,
        deletedAt: null,
        ...(parsed.data.checkInCode
          ? { checkInCode: parsed.data.checkInCode }
          : { userId: parsed.data.userId! }),
      },
      select: { userId: true, checkInCode: true },
    });
    if (!membership) throw new HttpError(404, { error: "Attendee not found for this event" });

    const method =
      parsed.data.method === "QR_SCAN" || parsed.data.checkInCode
        ? CheckInMethod.QR_SCAN
        : CheckInMethod.STAFF_SCAN;

    try {
      const checkIn = await prisma.checkIn.upsert({
        where: { userId_eventId: { userId: membership.userId, eventId: event.id } },
        update: {
          ...(parsed.data.clientMutationId
            ? { clientMutationId: parsed.data.clientMutationId }
            : {}),
        },
        create: {
          userId: membership.userId,
          eventId: event.id,
          method,
          scannedByUserId: req.user!.id,
          clientMutationId: parsed.data.clientMutationId ?? null,
        },
      });
      return res.json({ ...checkIn, checkInCode: membership.checkInCode, idempotentReplay: false });
    } catch (err) {
      // Race on clientMutationId unique — return existing
      if (parsed.data.clientMutationId) {
        const existing = await prisma.checkIn.findFirst({
          where: { clientMutationId: parsed.data.clientMutationId },
        });
        if (existing) return res.json({ ...existing, idempotentReplay: true });
      }
      throw err;
    }
  }),
);

checkinRouter.post(
  "/:userId",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    await requireFeature(event.id, "checkin");

    const targetMembership = await prisma.eventMembership.findUnique({
      where: { eventId_userId: { eventId: event.id, userId: req.params.userId } },
    });
    if (!targetMembership || targetMembership.deletedAt) {
      throw new HttpError(404, { error: "Participant not found" });
    }

    const checkIn = await prisma.checkIn.upsert({
      where: { userId_eventId: { userId: req.params.userId, eventId: event.id } },
      update: {},
      create: {
        userId: req.params.userId,
        eventId: event.id,
        method: CheckInMethod.STAFF_SCAN,
        scannedByUserId: req.user!.id,
      },
    });

    return res.json(checkIn);
  }),
);

checkinRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });

    const checkIns = await prisma.checkIn.findMany({
      where: { eventId: event.id },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: { createdAt: "desc" },
    });

    return res.json(checkIns);
  }),
);

checkinRouter.get(
  "/stats",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });

    const [checkedInCount, totalCount] = await Promise.all([
      prisma.checkIn.count({ where: { eventId: event.id } }),
      prisma.eventMembership.count({ where: { eventId: event.id, deletedAt: null } }),
    ]);

    return res.json({ checkedInCount, totalCount });
  }),
);
