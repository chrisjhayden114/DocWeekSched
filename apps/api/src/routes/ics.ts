import { brand, icsProductId } from "@event-app/config";
import { createHash, randomBytes } from "crypto";
import { Router } from "express";
import { asyncHandler, HttpError, requireEventAccess } from "../lib/authorization";
import { prisma } from "../lib/db";
import { resolveEventFromRequest } from "../lib/requestEvent";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";
import { authRateLimit } from "../lib/rateLimit";
import { env } from "../lib/env";

export const icsRouter = Router();

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function escapeIcs(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
}

function toIcsUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function buildAgendaIcs(params: {
  eventName: string;
  eventId: string;
  sessions: Array<{ id: string; title: string; description?: string | null; location?: string | null; startsAt: Date; endsAt: Date }>;
  blocks: Array<{ id: string; title: string; startsAt: Date; endsAt: Date }>;
}): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${icsProductId("Agenda")}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcs(params.eventName)}`,
  ];
  for (const s of params.sessions) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:session-${s.id}@${brand.domain}`,
      `DTSTAMP:${toIcsUtc(new Date())}`,
      `DTSTART:${toIcsUtc(s.startsAt)}`,
      `DTEND:${toIcsUtc(s.endsAt)}`,
      `SUMMARY:${escapeIcs(s.title)}`,
      s.description ? `DESCRIPTION:${escapeIcs(s.description.slice(0, 500))}` : "",
      s.location ? `LOCATION:${escapeIcs(s.location)}` : "",
      "END:VEVENT",
    );
  }
  for (const b of params.blocks) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:block-${b.id}@${brand.domain}`,
      `DTSTAMP:${toIcsUtc(new Date())}`,
      `DTSTART:${toIcsUtc(b.startsAt)}`,
      `DTEND:${toIcsUtc(b.endsAt)}`,
      `SUMMARY:${escapeIcs(b.title)}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.filter(Boolean).join("\r\n");
}

/** Create or rotate a read-only ICS subscription URL for My Agenda. */
icsRouter.post(
  "/feed",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    const userId = req.user!.id;
    await requireEventAccess(userId, event.id);

    await prisma.icsFeedToken.updateMany({
      where: { userId, eventId: event.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const raw = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(raw);
    await prisma.icsFeedToken.create({
      data: { userId, eventId: event.id, tokenHash },
    });

    const base = env.apiPublicUrl;
    const url = `${base.replace(/\/$/, "")}/ics/${raw}`;
    return res.status(201).json({ url, token: raw });
  }),
);

/** Public read-only ICS feed (token in path). */
icsRouter.get(
  "/:token",
  // Token GET tier. Calendar clients poll only every few hours; if a shared
  // venue NAT ever trips this, raise toward the public-read tier (60/min).
  authRateLimit({ windowMs: 60_000, max: 10 }),
  asyncHandler(async (req, res) => {
    const tokenHash = hashToken(String(req.params.token || ""));
    const feed = await prisma.icsFeedToken.findFirst({
      where: { tokenHash, revokedAt: null },
      include: { event: { select: { id: true, name: true } } },
    });
    if (!feed) throw new HttpError(404, { error: "Feed not found" });

    const attendances = await prisma.sessionAttendance.findMany({
      where: { userId: feed.userId, status: "JOINING", session: { eventId: feed.eventId } },
      include: {
        session: {
          select: {
            id: true,
            title: true,
            description: true,
            location: true,
            startsAt: true,
            endsAt: true,
          },
        },
      },
    });
    const blocks = await prisma.personalAgendaBlock.findMany({
      where: { userId: feed.userId, eventId: feed.eventId },
    });

    const body = buildAgendaIcs({
      eventName: feed.event.name,
      eventId: feed.eventId,
      sessions: attendances.map((a) => a.session),
      blocks,
    });

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="agenda-${feed.eventId}.ics"`);
    return res.send(body);
  }),
);

export function lookupIcsTokenHash(raw: string): string {
  return hashToken(raw);
}
