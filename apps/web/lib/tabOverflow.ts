/**
 * K-1 / K-6 — view-model for ConsoleTabStrip overflow. Leading tabs stay
 * visible; trailing tabs that do not fit move into the More menu. Founder
 * priority tabs (Ops Inbox, Recap) always live in More even when the row
 * would fit. If the active tab would overflow, it swaps with the last
 * visible so it stays on screen.
 */

export type TabOverflowPlan<Id extends string> = {
  visibleIds: Id[];
  overflowIds: Id[];
};

export type TabOverflowInput<Id extends string> = {
  ids: readonly Id[];
  /** Measured button widths, keyed by tab id. */
  widths: Readonly<Partial<Record<Id, number>>>;
  /** Inner width of the strip (More button still included in this number). */
  available: number;
  /** Measured width of the "More ▾" trigger. */
  moreWidth: number;
  activeId: Id;
  /** Flex gap between tabs (and before More). */
  gap?: number;
  /**
   * K-6 — these ids always go in More (in this order, first), even when
   * the full row would fit. Further measured overflow is appended after.
   */
  alwaysOverflowIds?: readonly Id[];
};

/** Console tabs that stay in More ▾ even when there is room on the strip. */
export const CONSOLE_TAB_ALWAYS_OVERFLOW = ["ops", "recap"] as const;

function sumRow<Id extends string>(ids: readonly Id[], widths: Readonly<Partial<Record<Id, number>>>, gap: number): number {
  return ids.reduce((total, id, index) => total + (widths[id] ?? 0) + (index > 0 ? gap : 0), 0);
}

function inOriginalOrder<Id extends string>(ids: readonly Id[], original: readonly Id[]): Id[] {
  const set = new Set(ids);
  return original.filter((id) => set.has(id));
}

function splitPinned<Id extends string>(ids: readonly Id[], alwaysOverflowIds: readonly Id[]): { candidates: Id[]; pinned: Id[] } {
  const idSet = new Set(ids);
  const pinned = alwaysOverflowIds.filter((id) => idSet.has(id));
  const pinnedSet = new Set(pinned);
  return { pinned, candidates: ids.filter((id) => !pinnedSet.has(id)) };
}

function overflowOrder<Id extends string>(pinned: readonly Id[], extra: readonly Id[], original: readonly Id[]): Id[] {
  const extraSet = new Set(extra);
  return [...pinned, ...original.filter((id) => extraSet.has(id) && !pinned.includes(id))];
}

/**
 * How many leading (non-pinned) tabs fit in `available`. Returns every id
 * as visible when measurement is not ready (zero available, or any tab
 * still unmeasured) so the strip does not hide tabs on the first paint —
 * except pinned always-overflow ids, which are tucked immediately.
 */
export function planTabOverflow<Id extends string>({
  ids,
  widths,
  available,
  moreWidth,
  activeId,
  gap = 0,
  alwaysOverflowIds = [],
}: TabOverflowInput<Id>): TabOverflowPlan<Id> {
  if (ids.length === 0) return { visibleIds: [], overflowIds: [] };
  const { candidates, pinned } = splitPinned(ids, alwaysOverflowIds);
  const measured = ids.every((id) => (widths[id] ?? 0) > 0);

  if (!measured || available <= 0) {
    if (pinned.length > 0) {
      return { visibleIds: [...candidates], overflowIds: [...pinned] };
    }
    return { visibleIds: [...ids], overflowIds: [] };
  }

  if (pinned.length === 0 && sumRow(ids, widths, gap) <= available) {
    return { visibleIds: [...ids], overflowIds: [] };
  }

  const budget = Math.max(0, available - moreWidth - (moreWidth > 0 ? gap : 0));
  const visible: Id[] = [];
  for (const id of candidates) {
    const next = [...visible, id];
    if (sumRow(next, widths, gap) <= budget) visible.push(id);
    else break;
  }

  if (visible.length === 0) {
    const keep = ids.includes(activeId) ? activeId : (candidates[0] ?? ids[0]);
    return {
      visibleIds: [keep],
      overflowIds: overflowOrder(
        pinned.filter((id) => id !== keep),
        ids.filter((id) => id !== keep),
        ids,
      ),
    };
  }

  const extra = candidates.filter((id) => !visible.includes(id));
  let overflow = overflowOrder(pinned, extra, ids);

  if (overflow.includes(activeId)) {
    const displaced = visible[visible.length - 1]!;
    visible[visible.length - 1] = activeId;
    const nextExtra = extra.map((id) => (id === activeId ? displaced : id));
    if (pinned.includes(activeId)) {
      overflow = overflowOrder(
        pinned.filter((id) => id !== activeId),
        [...nextExtra, displaced],
        ids,
      );
    } else {
      overflow = overflowOrder(pinned, nextExtra, ids);
    }
  }

  return { visibleIds: visible, overflowIds: overflow };
}
