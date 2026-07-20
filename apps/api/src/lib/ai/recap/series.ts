/**
 * Merge fixNextYear into EventSeries.setupChecklist — idempotent by key.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import type { FixNextYearItem, SeriesChecklistItem } from "./types";

export function mergeFixNextYearIntoChecklist(
  existing: unknown,
  items: FixNextYearItem[],
  meta: { sourceEventId: string; sourceRecapId: string },
): SeriesChecklistItem[] {
  const list: SeriesChecklistItem[] = Array.isArray(existing)
    ? (existing as SeriesChecklistItem[]).map((c) => ({
        key: String(c.key),
        label: String(c.label),
        done: Boolean(c.done),
        ...(c.sourceEventId ? { sourceEventId: String(c.sourceEventId) } : {}),
        ...(c.sourceRecapId ? { sourceRecapId: String(c.sourceRecapId) } : {}),
      }))
    : [];

  const byKey = new Map(list.map((c) => [c.key, c]));
  for (const item of items) {
    const prev = byKey.get(item.key);
    byKey.set(item.key, {
      key: item.key,
      label: item.label,
      done: prev?.done ?? false,
      sourceEventId: meta.sourceEventId,
      sourceRecapId: meta.sourceRecapId,
    });
  }
  // Preserve original order; append new keys at end.
  const out: SeriesChecklistItem[] = [];
  const seen = new Set<string>();
  for (const c of list) {
    const updated = byKey.get(c.key)!;
    out.push(updated);
    seen.add(c.key);
  }
  for (const item of items) {
    if (seen.has(item.key)) continue;
    out.push(byKey.get(item.key)!);
    seen.add(item.key);
  }
  return out;
}

export async function applyFixNextYearToSeries(input: {
  seriesId: string;
  eventId: string;
  recapId: string;
  fixNextYear: FixNextYearItem[];
}): Promise<SeriesChecklistItem[]> {
  const series = await prisma.eventSeries.findUnique({
    where: { id: input.seriesId },
    select: { id: true, setupChecklist: true },
  });
  if (!series) return [];

  const merged = mergeFixNextYearIntoChecklist(series.setupChecklist, input.fixNextYear, {
    sourceEventId: input.eventId,
    sourceRecapId: input.recapId,
  });

  await prisma.eventSeries.update({
    where: { id: series.id },
    data: { setupChecklist: merged as unknown as Prisma.InputJsonValue },
  });
  return merged;
}
