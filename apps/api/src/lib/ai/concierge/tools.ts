/**
 * Typed Concierge tools. Mutators never write from model output —
 * confirm loads ConciergePendingAction by id and runs these with server session ids.
 */

import { createHash, randomBytes } from "crypto";
import { SessionJoinMode } from "@prisma/client";
import type {
  ConciergePendingPreview,
  ConciergeToolName,
} from "@event-app/shared";
import { isConciergeMutatingTool } from "@event-app/shared";
import { prisma } from "../../db";
import { HttpError } from "../../authorization";
import { env } from "../../env";
import { assertMutuallyVisible } from "../../visibility";
import { joinSessionOrWaitlist, leaveSessionAttendance } from "../../waitlist/capacity";
import { assertGroundedIds } from "../grounding";
import type { GroundingContext } from "../types";
import { NotificationKind } from "@prisma/client";
import { notifyMany } from "../../notifications";

export { isConciergeMutatingTool };

export type ToolArgs = Record<string, unknown>;

export type ToolExecResult = {
  ok: true;
  summary: string;
  data?: Record<string, unknown>;
};

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function asMode(v: unknown): SessionJoinMode {
  if (v === "VIRTUAL" || v === "IN_PERSON" || v === "ASYNC") return v;
  return "IN_PERSON";
}

function sessionsOverlap(
  a: { startsAt: Date; endsAt: Date },
  b: { startsAt: Date; endsAt: Date },
): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

export async function buildMutationPreview(
  grounding: GroundingContext,
  tool: ConciergeToolName,
  args: ToolArgs,
  userId: string,
): Promise<ConciergePendingPreview> {
  switch (tool) {
    case "addToMyAgenda": {
      const sessionId = asString(args.sessionId);
      if (!sessionId) throw new HttpError(400, { error: "sessionId required" });
      assertGroundedIds(grounding, { sessionIds: [sessionId] });
      const session = grounding.sessions.find((s) => s.id === sessionId)!;
      const mode = asMode(args.mode);
      const overlaps: Array<{ sessionId: string; title: string }> = [];
      for (const id of grounding.myAgendaSessionIds) {
        const other = grounding.sessions.find((s) => s.id === id);
        if (other && other.id !== sessionId && sessionsOverlap(session, other)) {
          overlaps.push({ sessionId: other.id, title: other.title });
        }
      }
      const when = session.startsAt.toISOString().slice(0, 16).replace("T", " ");
      return {
        title: `Add “${session.title}”?`,
        body: `${when} UTC · ${mode.replace("_", " ").toLowerCase()}`,
        overlaps: overlaps.length ? overlaps : undefined,
        capacityNote: overlaps.length
          ? `Overlaps ${overlaps.length} session${overlaps.length === 1 ? "" : "s"} already on your agenda.`
          : null,
      };
    }
    case "removeFromMyAgenda": {
      const sessionId = asString(args.sessionId);
      if (!sessionId) throw new HttpError(400, { error: "sessionId required" });
      assertGroundedIds(grounding, { sessionIds: [sessionId] });
      const session = grounding.sessions.find((s) => s.id === sessionId)!;
      return {
        title: `Remove “${session.title}”?`,
        body: "This removes it from My Agenda (and frees a seat if you were joined).",
      };
    }
    case "exportICS":
      return {
        title: "Create calendar feed?",
        body: "Generates a private read-only ICS URL for your agenda on this event.",
      };
    case "proposeMeeting": {
      const toUserId = asString(args.toUserId);
      if (!toUserId) throw new HttpError(400, { error: "toUserId required" });
      const peer = await prisma.user.findUnique({
        where: { id: toUserId },
        select: { name: true },
      });
      return {
        title: `Propose a meeting with ${peer?.name || "this attendee"}?`,
        body: "They’ll get a meeting request with your suggested times.",
      };
    }
    case "joinWaitlist": {
      const sessionId = asString(args.sessionId);
      if (!sessionId) throw new HttpError(400, { error: "sessionId required" });
      assertGroundedIds(grounding, { sessionIds: [sessionId] });
      const session = grounding.sessions.find((s) => s.id === sessionId)!;
      const mode = asMode(args.mode);
      return {
        title: `Join waitlist for “${session.title}”?`,
        body: `Mode: ${mode}. You’ll be notified if a seat opens.`,
        capacityNote: "Session appears full for this mode.",
      };
    }
    default:
      throw new HttpError(400, { error: `Not a mutating tool: ${tool}` });
  }
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Execute a confirmed mutating tool. userId + eventId MUST come from the server session.
 */
export async function executeMutatingTool(params: {
  tool: ConciergeToolName;
  args: ToolArgs;
  eventId: string;
  userId: string;
  grounding: GroundingContext;
}): Promise<ToolExecResult> {
  const { tool, args, eventId, userId, grounding } = params;
  if (grounding.eventId !== eventId) {
    throw new HttpError(403, { error: "Grounding event mismatch" });
  }
  if (!isConciergeMutatingTool(tool)) {
    throw new HttpError(400, { error: "Not a mutating tool" });
  }

  switch (tool) {
    case "addToMyAgenda": {
      const sessionId = asString(args.sessionId);
      if (!sessionId) throw new HttpError(400, { error: "sessionId required" });
      assertGroundedIds(grounding, { sessionIds: [sessionId] });
      const mode = asMode(args.mode);
      const result = await joinSessionOrWaitlist({ sessionId, userId, mode });
      if (result.kind === "waitlisted") {
        return {
          ok: true,
          summary: result.message,
          data: { waitlisted: true, position: result.position },
        };
      }
      const title = grounding.sessions.find((s) => s.id === sessionId)?.title || "Session";
      return { ok: true, summary: `Added “${title}” to your agenda.`, data: { sessionId, mode } };
    }
    case "removeFromMyAgenda": {
      const sessionId = asString(args.sessionId);
      if (!sessionId) throw new HttpError(400, { error: "sessionId required" });
      assertGroundedIds(grounding, { sessionIds: [sessionId] });
      await leaveSessionAttendance({ sessionId, userId });
      const title = grounding.sessions.find((s) => s.id === sessionId)?.title || "Session";
      return { ok: true, summary: `Removed “${title}” from your agenda.` };
    }
    case "exportICS": {
      await prisma.icsFeedToken.updateMany({
        where: { userId, eventId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const raw = randomBytes(32).toString("base64url");
      await prisma.icsFeedToken.create({
        data: { userId, eventId, tokenHash: hashToken(raw) },
      });
      const url = `${env.apiPublicUrl.replace(/\/$/, "")}/ics/${raw}`;
      return { ok: true, summary: "Your calendar feed is ready.", data: { url } };
    }
    case "proposeMeeting": {
      const toUserId = asString(args.toUserId);
      if (!toUserId) throw new HttpError(400, { error: "toUserId required" });
      if (toUserId === userId) throw new HttpError(400, { error: "Cannot meet yourself" });
      const visible = await assertMutuallyVisible(eventId, userId, toUserId);
      if (!visible) {
        throw new HttpError(403, { error: "Both people must opt into the directory" });
      }
      const slotsRaw = Array.isArray(args.slots) ? args.slots : [];
      const slots = slotsRaw
        .map((s) => {
          if (!s || typeof s !== "object") return null;
          const o = s as { startsAt?: unknown; endsAt?: unknown };
          const startsAt = typeof o.startsAt === "string" ? new Date(o.startsAt) : null;
          const endsAt = typeof o.endsAt === "string" ? new Date(o.endsAt) : null;
          if (!startsAt || !endsAt || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
            return null;
          }
          return { startsAt, endsAt };
        })
        .filter((s): s is { startsAt: Date; endsAt: Date } => !!s)
        .slice(0, 8);
      if (!slots.length) throw new HttpError(400, { error: "At least one valid slot required" });
      const message = asString(args.message);
      const meeting = await prisma.meetingRequest.create({
        data: {
          eventId,
          fromUserId: userId,
          toUserId,
          message,
          slots: {
            create: slots.map((s, i) => ({
              startsAt: s.startsAt,
              endsAt: s.endsAt,
              sortOrder: i,
            })),
          },
        },
      });
      await notifyMany([
        {
          userId: toUserId,
          eventId,
          kind: NotificationKind.MEETING_REQUEST,
          title: "Meeting request",
          body: message?.slice(0, 200) || "Someone proposed meeting times",
          meetingRequestId: meeting.id,
        },
      ]);
      return { ok: true, summary: "Meeting request sent.", data: { meetingId: meeting.id } };
    }
    case "joinWaitlist": {
      const sessionId = asString(args.sessionId);
      if (!sessionId) throw new HttpError(400, { error: "sessionId required" });
      assertGroundedIds(grounding, { sessionIds: [sessionId] });
      const mode = asMode(args.mode);
      const result = await joinSessionOrWaitlist({ sessionId, userId, mode });
      if (result.kind === "joined") {
        return {
          ok: true,
          summary: "A seat was open — you’re on the agenda now.",
          data: { sessionId, joined: true },
        };
      }
      return {
        ok: true,
        summary: result.message,
        data: { waitlisted: true, position: result.position },
      };
    }
    default:
      throw new HttpError(400, { error: `Unsupported tool: ${tool}` });
  }
}

/** Read-only tools — safe to run immediately (no pending action). */
export async function runReadOnlyTool(params: {
  tool: ConciergeToolName;
  args: ToolArgs;
  grounding: GroundingContext;
  userId: string;
}): Promise<ToolExecResult> {
  const { tool, args, grounding, userId } = params;
  switch (tool) {
    case "searchSessions": {
      const q = (asString(args.query) || "").toLowerCase();
      const morning = Boolean(args.morning);
      let hits = grounding.sessions;
      if (q) {
        hits = hits.filter(
          (s) =>
            s.title.toLowerCase().includes(q) ||
            (s.description || "").toLowerCase().includes(q),
        );
      }
      if (morning) {
        hits = hits.filter((s) => {
          const h = s.startsAt.getUTCHours();
          return h >= 5 && h < 12;
        });
      }
      hits = hits.slice(0, 8);
      const lines = hits.map(
        (s) => `• ${s.title} (${s.startsAt.toISOString().slice(0, 16).replace("T", " ")} UTC)`,
      );
      return {
        ok: true,
        summary: lines.length
          ? `Here’s what I found:\n${lines.join("\n")}`
          : "No matching sessions in this event’s schedule.",
        data: { sessionIds: hits.map((s) => s.id) },
      };
    }
    case "getMyAgenda": {
      const mine = grounding.sessions.filter((s) => grounding.myAgendaSessionIds.has(s.id));
      if (!mine.length) {
        return { ok: true, summary: "Your agenda is empty for this event.", data: { sessionIds: [] } };
      }
      const lines = mine.map(
        (s) => `• ${s.title} (${s.startsAt.toISOString().slice(0, 16).replace("T", " ")} UTC)`,
      );
      return {
        ok: true,
        summary: `Your agenda:\n${lines.join("\n")}`,
        data: { sessionIds: mine.map((s) => s.id) },
      };
    }
    case "showOnMap": {
      const roomId = asString(args.roomId);
      if (!roomId) throw new HttpError(400, { error: "roomId required" });
      assertGroundedIds(grounding, { roomIds: [roomId] });
      const map = grounding.maps.find((m) => m.roomIds.includes(roomId));
      const room = await prisma.room.findFirst({
        where: { id: roomId, eventId: grounding.eventId },
        select: { name: true },
      });
      return {
        ok: true,
        summary: map
          ? `Open the map “${map.name}” for ${room?.name || "that room"}.`
          : `${room?.name || "That room"} isn’t pinned on a map yet.`,
        data: { roomId, mapId: map?.id || null, label: room?.name || roomId },
      };
    }
    default:
      void userId;
      throw new HttpError(400, { error: `Not a read-only tool: ${tool}` });
  }
}
