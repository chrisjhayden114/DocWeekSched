/**
 * Pure formatting helpers for the session peek sheet (Chunk H4 / D6).
 * Kept out of the component so the time·room·track line is unit-testable.
 */

import { formatEventTimeRange } from "./dateFormat";

export type PeekMetaSession = {
  startsAt: string;
  endsAt: string;
  location?: string | null;
  room?: { name: string } | null;
  track?: { name: string } | null;
};

/** "Mon, Jun 8 · 9:00 AM – 10:30 AM EDT · Room 2 · AI Track" — missing parts drop out. */
export function peekMeta(session: PeekMetaSession, timeZone: string): string {
  const bits: string[] = [formatEventTimeRange(session.startsAt, session.endsAt, timeZone)];
  const room = session.room?.name || session.location || null;
  if (room) bits.push(room);
  if (session.track?.name) bits.push(session.track.name);
  return bits.filter(Boolean).join(" · ");
}

/** Speakers line: the free-text speakers field wins over the single linked speaker. */
export function peekSpeakers(session: { speakers?: string | null; speaker?: { name: string } | null }): string {
  return session.speakers?.trim() || session.speaker?.name || "";
}
