/**
 * Deterministic track → color assignment (DESIGN_PHASE_D.md Part 2).
 *
 * When an event has ≤10 tracks, palette slots are assigned by stable order of
 * first appearance (creation/sort order) so no two tracks share a color.
 * Above 10 tracks, fall back to hashing the track id. Organizer-defined
 * colors always win.
 */

const TRACK_COUNT = 10;

/** List + grid session fill: ~6% track color mixed toward white (not gray). */
export const TRACK_FILL_MIX = 0.06;
/** Hover lift stays inside the 5–8% wash so text contrast does not move. */
export const TRACK_FILL_MIX_HOVER = 0.08;

/** Modifier on `.schedule-event` when the session has a track (or explicit color). */
export const SESSION_TRACK_TINT_CLASS = "schedule-event--tinted";

/** True when the card should use the light track wash instead of the neutral white. */
export function sessionHasTrack(
  trackId: string | null | undefined,
  explicit?: string | null,
): boolean {
  return Boolean(trackId || explicit);
}

/** Empty string for untracked / lunch-style rows — they keep the white card. */
export function sessionTrackTintClass(
  trackId: string | null | undefined,
  explicit?: string | null,
): string {
  return sessionHasTrack(trackId, explicit) ? SESSION_TRACK_TINT_CLASS : "";
}

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
