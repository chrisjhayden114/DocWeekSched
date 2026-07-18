import type { AgendaExtract, ExtractedSession } from "./schema";
import { sessionDedupeKey } from "./schema";

/**
 * Deterministic merge of chunk extracts: concat sessions/speakers/assumptions,
 * dedupe sessions by title+date+startTime (first wins, later fills blanks).
 */
export function mergeExtractChunks(chunks: AgendaExtract[]): AgendaExtract {
  if (chunks.length === 0) {
    return { sessions: [], assumptions: [] };
  }
  if (chunks.length === 1) return chunks[0];

  const event = chunks.map((c) => c.event).find((e) => e && (e.name || e.timezone || e.startDate));
  const sessionMap = new Map<string, ExtractedSession>();
  const speakers: NonNullable<AgendaExtract["speakers"]> = [];
  const speakerNames = new Set<string>();
  const assumptions: AgendaExtract["assumptions"] = [];
  const assumptionIds = new Set<string>();

  for (const chunk of chunks) {
    for (const s of chunk.sessions) {
      const key = sessionDedupeKey(s);
      const existing = sessionMap.get(key);
      if (!existing) {
        sessionMap.set(key, { ...s, items: s.items ? [...s.items] : undefined });
        continue;
      }
      sessionMap.set(key, {
        ...existing,
        description: existing.description || s.description,
        endTime: existing.endTime || s.endTime,
        room: existing.room || s.room,
        track: existing.track || s.track,
        speakers: existing.speakers.length ? existing.speakers : s.speakers,
        mode: existing.mode || s.mode,
        items: existing.items?.length ? existing.items : s.items,
        confidence: { ...(s.confidence || {}), ...(existing.confidence || {}) },
      });
    }
    for (const sp of chunk.speakers || []) {
      const k = sp.name.trim().toLowerCase();
      if (speakerNames.has(k)) continue;
      speakerNames.add(k);
      speakers.push(sp);
    }
    for (const a of chunk.assumptions || []) {
      if (assumptionIds.has(a.id)) continue;
      assumptionIds.add(a.id);
      assumptions.push(a);
    }
  }

  const sessions = [...sessionMap.values()].sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    if (d !== 0) return d;
    return a.startTime.localeCompare(b.startTime);
  });

  return {
    event: event || chunks[0].event,
    sessions,
    speakers: speakers.length ? speakers : undefined,
    assumptions,
  };
}

/** Split long source text into overlapping chunks for extraction. */
export function chunkSourceText(text: string, maxChars = 12_000, overlap = 400): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const chunks: string[] = [];
  let start = 0;
  while (start < trimmed.length) {
    const end = Math.min(trimmed.length, start + maxChars);
    chunks.push(trimmed.slice(start, end));
    if (end >= trimmed.length) break;
    start = Math.max(0, end - overlap);
  }
  return chunks;
}
