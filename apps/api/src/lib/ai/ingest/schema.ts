import { z } from "zod";

/** Per-field confidence 0–1; omitted fields default to 1 in UI. */
export const fieldConfidenceSchema = z.record(z.string(), z.number().min(0).max(1)).optional();

export const extractedItemSchema = z.object({
  title: z.string().min(1),
  authors: z.array(z.string().min(1)).default([]),
  presenterIndex: z.number().int().min(0).optional(),
  discussant: z.string().optional(),
  confidence: fieldConfidenceSchema,
});

export const extractedSessionSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  date: z.string().min(1), // YYYY-MM-DD
  startTime: z.string().min(1), // HH:MM
  endTime: z.string().optional(),
  room: z.string().optional(),
  track: z.string().optional(),
  speakers: z.array(z.string()).default([]),
  mode: z.enum(["IN_PERSON", "VIRTUAL", "HYBRID"]).optional(),
  items: z.array(extractedItemSchema).optional(),
  confidence: fieldConfidenceSchema,
});

export const extractedSpeakerSchema = z.object({
  name: z.string().min(1),
  title: z.string().optional(),
  affiliation: z.string().optional(),
  bio: z.string().optional(),
  confidence: fieldConfidenceSchema,
});

export const agendaExtractSchema = z.object({
  event: z
    .object({
      name: z.string().optional(),
      timezone: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    })
    .optional(),
  sessions: z.array(extractedSessionSchema).default([]),
  speakers: z.array(extractedSpeakerSchema).optional(),
  assumptions: z
    .array(
      z.object({
        id: z.string().min(1),
        question: z.string().min(1),
        defaultAnswer: z.string().optional(),
        appliesTo: z.string().optional(),
      }),
    )
    .default([]),
});

export type AgendaExtract = z.infer<typeof agendaExtractSchema>;
export type ExtractedSession = z.infer<typeof extractedSessionSchema>;
export type ExtractedItem = z.infer<typeof extractedItemSchema>;

/** Minimum confidence before UI ambers a field. */
export const LOW_CONFIDENCE = 0.8;

export function sessionDedupeKey(s: Pick<ExtractedSession, "title" | "date" | "startTime">): string {
  return `${normalizeTitle(s.title)}|${s.date}|${normalizeTime(s.startTime)}`;
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeTime(t: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  if (!m) return t.trim();
  return `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`;
}
