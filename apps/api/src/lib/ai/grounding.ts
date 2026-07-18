import { prisma } from "../db";
import type { GroundingContext } from "./types";

export class GroundingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GroundingError";
  }
}

/**
 * Assemble grounding for ONE event. eventId must come from the server session —
 * never from model output.
 */
export async function buildEventGroundingContext(eventId: string): Promise<GroundingContext> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      name: true,
      timezone: true,
      startDate: true,
      endDate: true,
      description: true,
      organizationId: true,
      sessions: {
        select: {
          id: true,
          title: true,
          startsAt: true,
          endsAt: true,
          roomId: true,
          trackId: true,
          description: true,
          speakers: true,
          sessionSpeakers: { select: { speakerId: true, speaker: { select: { id: true, name: true } } } },
          items: { select: { title: true, authors: { select: { name: true } } } },
        },
        orderBy: { startsAt: "asc" },
      },
      rooms: { select: { id: true, name: true } },
      tracks: { select: { id: true, name: true } },
      speakersRoster: { select: { id: true, name: true, title: true, affiliation: true } },
      announcements: {
        where: { publishedAt: { not: null } },
        select: { id: true, title: true, body: true },
        take: 20,
        orderBy: { publishedAt: "desc" },
      },
    },
  });
  if (!event) throw new GroundingError(`Event not found: ${eventId}`);

  const sessionIds = new Set(event.sessions.map((s) => s.id));
  const roomIds = new Set(event.rooms.map((r) => r.id));
  const trackIds = new Set(event.tracks.map((t) => t.id));
  const speakerIds = new Set(event.speakersRoster.map((s) => s.id));
  for (const s of event.sessions) {
    for (const row of s.sessionSpeakers) speakerIds.add(row.speakerId);
  }

  const lines: string[] = [
    `Event: ${event.name} (${event.timezone})`,
    event.description ? `Description: ${event.description}` : "",
    "Sessions:",
    ...event.sessions.map((s) => {
      const speakers = s.sessionSpeakers.map((r) => r.speaker.name).join(", ") || s.speakers || "";
      const items = s.items.map((i) => `${i.title} [${i.authors.map((a) => a.name).join(", ")}]`).join("; ");
      return `- [${s.id}] ${s.title} ${s.startsAt.toISOString()}–${s.endsAt.toISOString()}${speakers ? ` speakers=${speakers}` : ""}${items ? ` items=${items}` : ""}`;
    }),
    "Rooms:",
    ...event.rooms.map((r) => `- [${r.id}] ${r.name}`),
    "Tracks:",
    ...event.tracks.map((t) => `- [${t.id}] ${t.name}`),
    "Speakers:",
    ...event.speakersRoster.map((s) => `- [${s.id}] ${s.name}`),
  ].filter(Boolean);

  return {
    eventId: event.id,
    organizationId: event.organizationId,
    event: {
      id: event.id,
      name: event.name,
      timezone: event.timezone,
      startDate: event.startDate,
      endDate: event.endDate,
      description: event.description,
    },
    sessionIds,
    speakerIds,
    roomIds,
    trackIds,
    sessions: event.sessions.map((s) => ({
      id: s.id,
      title: s.title,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      roomId: s.roomId,
      trackId: s.trackId,
    })),
    textBlob: lines.join("\n"),
  };
}

export type GroundedIdCandidates = {
  sessionIds?: string[];
  speakerIds?: string[];
  roomIds?: string[];
  trackIds?: string[];
  /** Any id claimed to belong to this event — rejected if not in grounding sets. */
  eventId?: string;
};

/**
 * Reject foreign IDs from model output. eventId in candidates must match grounding.eventId.
 */
export function assertGroundedIds(grounding: GroundingContext, candidates: GroundedIdCandidates): void {
  if (candidates.eventId && candidates.eventId !== grounding.eventId) {
    throw new GroundingError(`Foreign eventId rejected: ${candidates.eventId}`);
  }
  for (const id of candidates.sessionIds || []) {
    if (!grounding.sessionIds.has(id)) throw new GroundingError(`Foreign sessionId rejected: ${id}`);
  }
  for (const id of candidates.speakerIds || []) {
    if (!grounding.speakerIds.has(id)) throw new GroundingError(`Foreign speakerId rejected: ${id}`);
  }
  for (const id of candidates.roomIds || []) {
    if (!grounding.roomIds.has(id)) throw new GroundingError(`Foreign roomId rejected: ${id}`);
  }
  for (const id of candidates.trackIds || []) {
    if (!grounding.trackIds.has(id)) throw new GroundingError(`Foreign trackId rejected: ${id}`);
  }
}
