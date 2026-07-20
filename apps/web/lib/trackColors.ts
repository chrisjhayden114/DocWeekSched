/**
 * Deterministic track → color assignment (DESIGN_PHASE_D.md Part 2).
 *
 * When an event has ≤10 tracks, palette slots are assigned by stable order of
 * first appearance (creation/sort order) so no two tracks share a color.
 * Above 10 tracks, fall back to hashing the track id. Organizer-defined
 * colors always win.
 */

const TRACK_COUNT = 10;

function hashString(value: string): number {
  // djb2 — stable across sessions and platforms.
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * @param orderedTrackIds Stable first-appearance / sort-order list of track ids
 *   for the event. When length is 1–10, index maps to --track-1..N with no
 *   collisions. When longer (or omitted), hashing is used.
 */
export function trackColor(
  trackId: string | null | undefined,
  explicit?: string | null,
  orderedTrackIds?: readonly string[] | null,
): string {
  if (explicit) return explicit;
  if (!trackId) return "var(--gray-300)";
  if (orderedTrackIds && orderedTrackIds.length > 0 && orderedTrackIds.length <= TRACK_COUNT) {
    const idx = orderedTrackIds.indexOf(trackId);
    if (idx >= 0) return `var(--track-${idx + 1})`;
  }
  return `var(--track-${(hashString(trackId) % TRACK_COUNT) + 1})`;
}
