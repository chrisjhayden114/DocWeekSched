/**
 * Phase 6 onboarding checklist helpers — EventSeries.setupChecklist JSON.
 */

import { PHASE6_ONBOARDING_CHECKLIST, type OnboardingChecklistItem } from "@event-app/shared";
import { EventMemberRole, type Prisma } from "@prisma/client";
import { prisma } from "../db";

export type ChecklistKey = OnboardingChecklistItem["key"];

function normalizeChecklist(raw: unknown): OnboardingChecklistItem[] {
  const byKey = new Map<string, OnboardingChecklistItem>();
  for (const base of PHASE6_ONBOARDING_CHECKLIST) {
    byKey.set(base.key, { ...base });
  }
  if (Array.isArray(raw)) {
    for (const row of raw) {
      if (!row || typeof row !== "object") continue;
      const key = (row as { key?: string }).key;
      if (!key || !byKey.has(key)) continue;
      const done = Boolean((row as { done?: boolean }).done);
      const label =
        typeof (row as { label?: string }).label === "string"
          ? (row as { label: string }).label
          : byKey.get(key)!.label;
      byKey.set(key, { key: key as ChecklistKey, label, done });
    }
  }
  return PHASE6_ONBOARDING_CHECKLIST.map((c) => byKey.get(c.key)!);
}

export async function markEventChecklistDone(eventId: string, key: ChecklistKey): Promise<void> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { seriesId: true },
  });
  if (!event?.seriesId) return;
  await markSeriesChecklistDone(event.seriesId, key);
}

export async function markSeriesChecklistDone(seriesId: string, key: ChecklistKey): Promise<void> {
  const series = await prisma.eventSeries.findUnique({
    where: { id: seriesId },
    select: { setupChecklist: true },
  });
  if (!series) return;
  const list = normalizeChecklist(series.setupChecklist).map((item) =>
    item.key === key ? { ...item, done: true } : item,
  );
  await prisma.eventSeries.update({
    where: { id: seriesId },
    data: { setupChecklist: list as unknown as Prisma.InputJsonValue },
  });
}

export async function getPrimaryChecklistForUser(userId: string): Promise<{
  seriesId: string | null;
  eventId: string | null;
  checklist: OnboardingChecklistItem[];
}> {
  const membership = await prisma.eventMembership.findFirst({
    where: {
      userId,
      deletedAt: null,
      role: EventMemberRole.ADMIN,
      event: { status: { in: ["DRAFT", "ACTIVE"] }, seriesId: { not: null } },
    },
    orderBy: { createdAt: "desc" },
    select: {
      eventId: true,
      event: { select: { seriesId: true, series: { select: { setupChecklist: true } } } },
    },
  });

  if (!membership?.event.seriesId) {
    return {
      seriesId: null,
      eventId: null,
      checklist: PHASE6_ONBOARDING_CHECKLIST.map((c) => ({ ...c })),
    };
  }

  return {
    seriesId: membership.event.seriesId,
    eventId: membership.eventId,
    checklist: normalizeChecklist(membership.event.series?.setupChecklist),
  };
}
