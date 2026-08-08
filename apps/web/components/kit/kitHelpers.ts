/**
 * Pure kit helpers, kept in a .ts module (no JSX) so the node test suite
 * can import them directly — the same split as lib/selectControl.
 */

/** "Jane van der Berg" → "JV" — first letters of the first two words. */
export function initialsFor(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

/** Wrapping arrow-key step across the FilterPills row. */
export function nextPillIndex(count: number, current: number, delta: number): number {
  if (count <= 0) return -1;
  return (((current + delta) % count) + count) % count;
}
