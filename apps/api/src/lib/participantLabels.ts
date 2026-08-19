/**
 * PART-1 — organizer-defined per-event participant labels.
 *
 * Stored on Event.participantLabelsJson (JSON string[] or null = none).
 * Each EventMembership.participantLabel must be one of that event's labels
 * (or null) at write time.
 *
 * Decision: deleting a label from the event list NULLs memberships holding it.
 */

import { HttpError } from "./authorization";
import { prisma } from "./db";

export const PARTICIPANT_LABELS_MAX = 20;
export const PARTICIPANT_LABEL_MIN_CHARS = 1;
export const PARTICIPANT_LABEL_MAX_CHARS = 40;

export type NormalizeLabelsResult =
  | { ok: true; labels: string[] }
  | { ok: false; error: string };

export type MembershipLabelResult =
  | { ok: true; label: string | null }
  | { ok: false; error: string };

/** Forgiving read: malformed / empty JSON → []. */
export function parseParticipantLabels(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    const cleaned = parsed
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter((v) => v.length >= PARTICIPANT_LABEL_MIN_CHARS && v.length <= PARTICIPANT_LABEL_MAX_CHARS);
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const label of cleaned) {
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(label);
    }
    return unique.slice(0, PARTICIPANT_LABELS_MAX);
  } catch {
    return [];
  }
}

/**
 * Strict write-time validation: ≤20 labels, each trimmed, 1–40 chars, unique
 * (case-insensitive). Blank entries are dropped. Empty result is a valid clear.
 */
export function normalizeParticipantLabels(input: unknown): NormalizeLabelsResult {
  if (!Array.isArray(input)) {
    return { ok: false, error: "participantLabels must be an array of strings" };
  }
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") {
      return { ok: false, error: "Each label must be a string" };
    }
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.length > PARTICIPANT_LABEL_MAX_CHARS) {
      return {
        ok: false,
        error: `Each label must be ${PARTICIPANT_LABEL_MIN_CHARS}–${PARTICIPANT_LABEL_MAX_CHARS} characters`,
      };
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      return { ok: false, error: "Labels must be unique" };
    }
    seen.add(key);
    labels.push(trimmed);
  }
  if (labels.length > PARTICIPANT_LABELS_MAX) {
    return { ok: false, error: `At most ${PARTICIPANT_LABELS_MAX} labels` };
  }
  return { ok: true, labels };
}

/** Membership write: null/blank clears; otherwise must be an exact event-list match. */
export function normalizeMembershipLabel(
  input: string | null | undefined,
  eventLabels: string[],
): MembershipLabelResult {
  if (input == null) return { ok: true, label: null };
  const trimmed = input.trim();
  if (!trimmed) return { ok: true, label: null };
  if (!eventLabels.includes(trimmed)) {
    return { ok: false, error: "Label must be one of this event's participant labels" };
  }
  return { ok: true, label: trimmed };
}

/** Client event payload: parsed array, raw JSON column omitted. */
export function toEventClient<T extends object>(
  event: T,
): Omit<T, "participantLabelsJson"> & { participantLabels: string[] } {
  const record = event as T & { participantLabelsJson?: string | null };
  const { participantLabelsJson, ...rest } = record;
  return {
    ...(rest as Omit<T, "participantLabelsJson">),
    participantLabels: parseParticipantLabels(participantLabelsJson),
  };
}

/**
 * Persist the organizer's label list. null / [] clears the column and NULLs
 * every membership label on this event. Removing a subset NULLs only rows
 * whose label is no longer in the list.
 */
export async function saveEventParticipantLabels(params: {
  eventId: string;
  labels: string[] | null;
}): Promise<string[]> {
  const normalized = params.labels == null ? { ok: true as const, labels: [] } : normalizeParticipantLabels(params.labels);
  if (!normalized.ok) {
    throw new HttpError(400, { error: normalized.error });
  }
  const value = normalized.labels.length ? JSON.stringify(normalized.labels) : null;
  await prisma.$transaction(async (tx) => {
    await tx.event.update({
      where: { id: params.eventId },
      data: { participantLabelsJson: value },
    });
    if (normalized.labels.length === 0) {
      await tx.eventMembership.updateMany({
        where: { eventId: params.eventId, participantLabel: { not: null } },
        data: { participantLabel: null },
      });
    } else {
      await tx.eventMembership.updateMany({
        where: {
          eventId: params.eventId,
          participantLabel: { notIn: normalized.labels },
        },
        data: { participantLabel: null },
      });
    }
  });
  return normalized.labels;
}

export async function setMembershipParticipantLabel(params: {
  eventId: string;
  userId: string;
  label: string | null;
}): Promise<string | null> {
  const event = await prisma.event.findUnique({
    where: { id: params.eventId },
    select: { participantLabelsJson: true },
  });
  if (!event) throw new HttpError(404, { error: "Event not found" });
  const labels = parseParticipantLabels(event.participantLabelsJson);
  const next = normalizeMembershipLabel(params.label, labels);
  if (!next.ok) throw new HttpError(400, { error: next.error });
  const updated = await prisma.eventMembership.updateMany({
    where: { eventId: params.eventId, userId: params.userId, deletedAt: null },
    data: { participantLabel: next.label },
  });
  if (updated.count === 0) throw new HttpError(404, { error: "Not a member of this event" });
  return next.label;
}
