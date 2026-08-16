/**
 * CHAT-2 (B3) — organizer-configurable starter questions for the Event
 * assistant. Stored on Event.assistantStartersJson (null = defaults); the
 * defaults are the shared starter-chip labels. Reads are forgiving (any
 * malformed value falls back to defaults); writes are manage-only and
 * validated hard.
 */

import { CONCIERGE_STARTER_CHIPS } from "@event-app/shared";
import type { Prisma } from "@prisma/client";
import { HttpError, requireEventAccess } from "../../authorization";
import { prisma } from "../../db";

export const ASSISTANT_STARTERS_MAX_ITEMS = 3;
export const ASSISTANT_STARTER_MIN_CHARS = 3;
export const ASSISTANT_STARTER_MAX_CHARS = 80;

/** The stock three starters (labels only — no "Soon" meta anywhere). */
export const DEFAULT_ASSISTANT_STARTERS: string[] = CONCIERGE_STARTER_CHIPS.map((c) => c.label);

/**
 * Parse the stored column into the starters the attendee UI shows.
 * null/invalid/empty → the defaults; entries are trimmed, length-checked,
 * and capped, so a hand-edited row can never break the chip layout.
 */
export function parseAssistantStarters(json: string | null | undefined): string[] {
  if (!json) return DEFAULT_ASSISTANT_STARTERS;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return DEFAULT_ASSISTANT_STARTERS;
    const cleaned = parsed
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter(
        (v) => v.length >= ASSISTANT_STARTER_MIN_CHARS && v.length <= ASSISTANT_STARTER_MAX_CHARS,
      )
      .slice(0, ASSISTANT_STARTERS_MAX_ITEMS);
    return cleaned.length ? cleaned : DEFAULT_ASSISTANT_STARTERS;
  } catch {
    return DEFAULT_ASSISTANT_STARTERS;
  }
}

/**
 * Persist the organizer's starters (manage-only). An empty list clears the
 * override back to null = defaults. Returns the starters attendees will see.
 */
export async function saveAssistantStarters(params: {
  eventId: string;
  userId: string;
  starters: string[];
}): Promise<string[]> {
  await requireEventAccess(params.userId, params.eventId, { manage: true });

  const trimmed = params.starters.map((s) => s.trim()).filter((s) => s.length > 0);
  if (trimmed.length > ASSISTANT_STARTERS_MAX_ITEMS) {
    throw new HttpError(400, {
      error: `At most ${ASSISTANT_STARTERS_MAX_ITEMS} starter questions`,
    });
  }
  for (const starter of trimmed) {
    if (
      starter.length < ASSISTANT_STARTER_MIN_CHARS ||
      starter.length > ASSISTANT_STARTER_MAX_CHARS
    ) {
      throw new HttpError(400, {
        error: `Each starter must be ${ASSISTANT_STARTER_MIN_CHARS}–${ASSISTANT_STARTER_MAX_CHARS} characters`,
      });
    }
  }

  const value = trimmed.length ? JSON.stringify(trimmed) : null;
  await prisma.event.update({
    where: { id: params.eventId },
    // Cast: assistantStartersJson lands with the CHAT-2 migration; the
    // checked-in generated client learns the field on the next
    // `prisma generate` (part of the API build).
    data: { assistantStartersJson: value } as unknown as Prisma.EventUpdateInput,
  });
  return parseAssistantStarters(value);
}
