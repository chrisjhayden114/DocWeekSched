/**
 * K-1 — view-model for ConsoleTabStrip overflow. Leading tabs stay visible;
 * trailing tabs that do not fit move into the More menu. If the active tab
 * would overflow, it swaps with the last visible so it stays on screen.
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
};

function sumRow<Id extends string>(ids: readonly Id[], widths: Readonly<Partial<Record<Id, number>>>, gap: number): number {
  return ids.reduce((total, id, index) => total + (widths[id] ?? 0) + (index > 0 ? gap : 0), 0);
}

function inOriginalOrder<Id extends string>(ids: readonly Id[], original: readonly Id[]): Id[] {
  const set = new Set(ids);
  return original.filter((id) => set.has(id));
}

/**
 * How many leading tabs fit in `available`. Returns every id as visible when
 * measurement is not ready (zero available, or any tab still unmeasured) so
 * the strip does not hide tabs on the first paint.
 */
export function planTabOverflow<Id extends string>({
  ids,
  widths,
  available,
  moreWidth,
  activeId,
  gap = 0,
}: TabOverflowInput<Id>): TabOverflowPlan<Id> {
  if (ids.length === 0) return { visibleIds: [], overflowIds: [] };
  const measured = ids.every((id) => (widths[id] ?? 0) > 0);
  if (!measured || available <= 0) {
    return { visibleIds: [...ids], overflowIds: [] };
  }

  if (sumRow(ids, widths, gap) <= available) {
    return { visibleIds: [...ids], overflowIds: [] };
  }

  const budget = Math.max(0, available - moreWidth - (moreWidth > 0 ? gap : 0));
  const visible: Id[] = [];
  for (const id of ids) {
    const next = [...visible, id];
    if (sumRow(next, widths, gap) <= budget) visible.push(id);
    else break;
  }

  if (visible.length === 0) {
    const keep = ids.includes(activeId) ? activeId : ids[0];
    return { visibleIds: [keep], overflowIds: ids.filter((id) => id !== keep) };
  }

  let overflow = ids.filter((id) => !visible.includes(id));
  if (overflow.includes(activeId)) {
    const displaced = visible[visible.length - 1]!;
    visible[visible.length - 1] = activeId;
    overflow = inOriginalOrder(
      overflow.map((id) => (id === activeId ? displaced : id)),
      ids,
    );
  }

  return { visibleIds: visible, overflowIds: overflow };
}
