import { Router } from "express";
import { z } from "zod";
import { MeetingRequestStatus, NotificationKind, PersonalAgendaSource } from "@prisma/client";
import { asyncHandler, HttpError, requireEventAccess } from "../lib/authorization";
import { prisma } from "../lib/db";
import { resolveEventFromRequest } from "../lib/requestEvent";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";
import { assertMutuallyVisible } from "../lib/visibility";
import { notifyMany } from "../lib/notifications";
import { validationErrorBody } from "../lib/errors";

export const meetingsRouter = Router();

const createSchema = z.object({
  toUserId: z.string().min(1),
  message: z.string().max(2000).optional(),
  slots: z
    .array(
      z.object({
        startsAt: z.string().datetime(),
        endsAt: z.string().datetime(),
      }),
    )
    .min(1)
    .max(8),
});

meetingsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    const userId = req.user!.id;
    await requireEventAccess(userId, event.id);
    const rows = await prisma.meetingRequest.findMany({
      where: {
        eventId: event.id,
        OR: [{ fromUserId: userId }, { toUserId: userId }],
      },
      include: {
        slots: { orderBy: { sortOrder: "asc" } },
        fromUser: { select: { id: true, name: true, photoUrl: true } },
        toUser: { select: { id: true, name: true, photoUrl: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return res.json(rows);
  }),
);

meetingsRouter.post(
  "/",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationErrorBody(parsed.error));
    const event = await resolveEventFromRequest(req);
    const fromUserId = req.user!.id;
    const toUserId = parsed.data.toUserId;
    await requireEventAccess(fromUserId, event.id);
    if (fromUserId === toUserId) throw new HttpError(400, { error: "Cannot request a meeting with yourself" });

    const visible = await assertMutuallyVisible(event.id, fromUserId, toUserId);
    if (!visible) {
      throw new HttpError(403, { error: "Both people must opt into the directory to request a meeting" });
    }

    const meeting = await prisma.meetingRequest.create({
      data: {
        eventId: event.id,
        fromUserId,
        toUserId,
        message: parsed.data.message?.trim() || null,
        slots: {
          create: parsed.data.slots.map((s, i) => ({
            startsAt: new Date(s.startsAt),
            endsAt: new Date(s.endsAt),
            sortOrder: i,
          })),
        },
      },
      include: { slots: true },
    });

    await notifyMany([
      {
        userId: toUserId,
        eventId: event.id,
        kind: NotificationKind.MEETING_REQUEST,
        title: "Meeting request",
        body: parsed.data.message?.slice(0, 200) || "Someone proposed meeting times",
        meetingRequestId: meeting.id,
      },
    ]);

    return res.status(201).json(meeting);
  }),
);

meetingsRouter.post(
  "/:id/accept",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const slotId = typeof req.body?.slotId === "string" ? req.body.slotId : null;
    const event = await resolveEventFromRequest(req);
    const userId = req.user!.id;
    await requireEventAccess(userId, event.id);

    const meeting = await prisma.meetingRequest.findFirst({
      where: { id: req.params.id, eventId: event.id },
      include: { slots: { orderBy: { sortOrder: "asc" } }, fromUser: true, toUser: true },
    });
    if (!meeting) throw new HttpError(404, { error: "Meeting request not found" });
    if (meeting.toUserId !== userId) throw new HttpError(403, { error: "Only the recipient can accept" });
    if (meeting.status !== MeetingRequestStatus.PENDING) {
      throw new HttpError(400, { error: "Meeting request is not pending" });
    }

    const slot = slotId
      ? meeting.slots.find((s) => s.id === slotId)
      : meeting.slots[0];
    if (!slot) throw new HttpError(400, { error: "Invalid slot" });

    const title = `Meeting: ${meeting.fromUser.name} & ${meeting.toUser.name}`;

    await prisma.$transaction(async (tx) => {
      await tx.meetingRequest.update({
        where: { id: meeting.id },
        data: { status: MeetingRequestStatus.ACCEPTED, respondedAt: new Date() },
      });
      await tx.personalAgendaBlock.createMany({
        data: [
          {
            userId: meeting.fromUserId,
            eventId: event.id,
            title,
            startsAt: slot.startsAt,
            endsAt: slot.endsAt,
            source: PersonalAgendaSource.MEETING,
            meetingRequestId: meeting.id,
          },
          {
            userId: meeting.toUserId,
            eventId: event.id,
            title,
            startsAt: slot.startsAt,
            endsAt: slot.endsAt,
            source: PersonalAgendaSource.MEETING,
            meetingRequestId: meeting.id,
          },
        ],
      });
    });

    await notifyMany([
      {
        userId: meeting.fromUserId,
        eventId: event.id,
        kind: NotificationKind.MEETING_ACCEPTED,
        title: "Meeting accepted",
        body: title,
        meetingRequestId: meeting.id,
      },
    ]);

    const blocks = await prisma.personalAgendaBlock.findMany({
      where: { meetingRequestId: meeting.id },
    });
    return res.json({ ok: true, blocks });
  }),
);

meetingsRouter.post(
  "/:id/decline",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    const userId = req.user!.id;
    await requireEventAccess(userId, event.id);
    const meeting = await prisma.meetingRequest.findFirst({
      where: { id: req.params.id, eventId: event.id },
    });
    if (!meeting) throw new HttpError(404, { error: "Meeting request not found" });
    if (meeting.toUserId !== userId && meeting.fromUserId !== userId) {
      throw new HttpError(403, { error: "Not a party to this meeting" });
    }
    await prisma.meetingRequest.update({
      where: { id: meeting.id },
      data: {
        status: meeting.toUserId === userId ? MeetingRequestStatus.DECLINED : MeetingRequestStatus.CANCELLED,
        respondedAt: new Date(),
      },
    });
    return res.json({ ok: true });
  }),
);
