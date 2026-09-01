/**
 * Deterministic track → color assignment (DESIGN_PHASE_D.md Part 2).
 *
 * When an event has ≤10 tracks, palette slots are assigned by stable order of
 * first appearance (creation/sort order) so no two tracks share a color.
 * Above 10 tracks, fall back to hashing the track id. Organizer-defined
 * colors always win.
 *
 * UI-2 — untracked rows also get a ~6% wash. The hue is picked from a small
 * calm palette as the candidate with the greatest minimum hue distance from
 * every track hue on the event (same input → same choice). No tracks → first
 * palette hue.
 */

const TRACK_COUNT = 10;

/** List + grid session fill: ~6% track color mixed toward white (not gray). */
export const TRACK_FILL_MIX = 0.06;
/** Hover lift stays inside the 5–8% wash so text contrast does not move. */
export const TRACK_FILL_MIX_HOVER = 0.08;

/** Modifier on `.schedule-event` when the session has a wash color. */
export const SESSION_TRACK_TINT_CLASS = "schedule-event--tinted";

/**
 * Modifier on a pick-one slot row that is still a decision control.
 * Event Schedule: both Choose and Change. My Schedule: unchosen only.
 */
export const SESSION_DECISION_AMBER_CLASS = "breakout-slot--decision";

/** Saturated gold mixed at --track-fill-mix toward white (matches tokens.css). */
export const DECISION_AMBER_HEX = "#c9920a";

/** Agenda list the attendee is looking at — pick-one amber depends on this. */
export type AgendaScheduleView = "eventSchedule" | "mySchedule";

/** Palette hexes matching --track-1..10 in tokens.css. */
export const TRACK_PALETTE_HEX = [
  "#0960ab",
  "#07662b",
  "#892264",
  "#c55113",
  "#473bbd",
  "#990f0f",
  "#0f766e",
  "#673ab7",
  "#a16207",
  "#505158",
] as const;

/**
 * Calm candidate hues for untracked / lunch-style rows. First entry is the
 * no-tracks default. Order is the tie-break (greatest min-distance wins;
 * first in this list wins a tie).
 */
export const UNTRACKED_TINT_PALETTE = [
  { id: "slate-teal", hex: "#5a7d7a" },
  { id: "warm-sand", hex: "#b8956a" },
  { id: "soft-mauve", hex: "#8d7384" },
  { id: "cool-gray-blue", hex: "#6a7b90" },
] as const;

const TRACK_VAR_RE = /^var\(--track-(\d+)\)$/i;

/** True when the card has a wash color (track, organizer hex, or untracked hue). */
export function sessionHasTrack(
  trackId: string | null | undefined,
  explicit?: string | null,
): boolean {
  return Boolean(trackId || explicit);
}

/** Tint modifier when a wash color is present — untracked cards pass the event hue as `explicit`. */
export function sessionTrackTintClass(
  trackId: string | null | undefined,
  explicit?: string | null,
): string {
  return sessionHasTrack(trackId, explicit) ? SESSION_TRACK_TINT_CLASS : "";
}

/**
 * Event Schedule: the slot row is always the decision control, so amber
 * stays in both "Choose your session" and "Change your session".
 * My Schedule: amber only while unchosen; a picked row uses the session tint.
 */
export function pickOneRowIsAmber(chosen: boolean, agendaView: AgendaScheduleView): boolean {
  return agendaView === "eventSchedule" || !chosen;
}

/** Amber class when `pickOneRowIsAmber` (or any other caller) says the row is a decision. */
export function sessionDecisionAmberClass(isAmber: boolean): string {
  return isAmber ? SESSION_DECISION_AMBER_CLASS : "";
}

function hashString(value: string): number {
  // djb2 — stable across sessions and platforms.
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function normalizeHex(input: string): string | null {
  const hex = input.trim().replace(/^#/, "");
  const full =
    /^[0-9a-fA-F]{3}$/.test(hex) ? hex.split("").map((c) => c + c).join("") :
    /^[0-9a-fA-F]{6}$/.test(hex) ? hex :
    null;
  return full ? `#${full.toLowerCase()}` : null;
}

/** Hex from `#rgb` / `#rrggbb` or `var(--track-N)`. */
export function parseCssColorToHex(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const varMatch = trimmed.match(TRACK_VAR_RE);
  if (varMatch) {
    const n = Number(varMatch[1]);
    if (n >= 1 && n <= TRACK_COUNT) return TRACK_PALETTE_HEX[n - 1]!;
    return null;
  }
  return normalizeHex(trimmed);
}

/** Resolved hex for a track — organizer color wins, else the assigned palette slot. */
export function resolveTrackHex(
  trackId: string | null | undefined,
  explicit?: string | null,
  orderedTrackIds?: readonly string[] | null,
): string | null {
  if (explicit) {
    const fromExplicit = parseCssColorToHex(explicit);
    if (fromExplicit) return fromExplicit;
  }
  if (!trackId) return null;
  if (orderedTrackIds && orderedTrackIds.length > 0 && orderedTrackIds.length <= TRACK_COUNT) {
    const idx = orderedTrackIds.indexOf(trackId);
    if (idx >= 0) return TRACK_PALETTE_HEX[idx]!;
  }
  return TRACK_PALETTE_HEX[hashString(trackId) % TRACK_COUNT]!;
}

/** Hue in degrees [0, 360). Grayscale (no chroma) is 0. */
export function hexHue(hex: string): number {
  const parsed = normalizeHex(hex) ?? parseCssColorToHex(hex);
  if (!parsed) return 0;
  const r = parseInt(parsed.slice(1, 3), 16) / 255;
  const g = parseInt(parsed.slice(3, 5), 16) / 255;
  const b = parseInt(parsed.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  let hue = 0;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  return hue;
}

/** Smallest circular distance between two hues in degrees, in [0, 180]. */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Pick the untracked wash hue for an event. Deterministic: same track hexes
 * (order-insensitive for the score; palette order breaks ties) → same hex.
 * Empty / unparsable input → first palette hue.
 */
export function pickUntrackedTintHex(trackHexes: readonly string[]): string {
  const hues: number[] = [];
  for (const raw of trackHexes) {
    const hex = parseCssColorToHex(raw);
    if (hex) hues.push(hexHue(hex));
  }
  if (hues.length === 0) return UNTRACKED_TINT_PALETTE[0].hex;
  let bestHex: string = UNTRACKED_TINT_PALETTE[0].hex;
  let bestScore = -1;
  for (const candidate of UNTRACKED_TINT_PALETTE) {
    const cHue = hexHue(candidate.hex);
    let minDist = Infinity;
    for (const h of hues) {
      const d = hueDistance(cHue, h);
      if (d < minDist) minDist = d;
    }
    if (minDist > bestScore) {
      bestScore = minDist;
      bestHex = candidate.hex;
    }
  }
  return bestHex;
}

/**
 * @param orderedTrackIds Stable first-appearance / sort-order list of track ids
 *   for the event. When length is 1–10, index maps to --track-1..N with no
 *   collisions. When longer (or omitted), hashing is used.
 * @param untrackedTint Hex (or CSS color) used when the session has no track.
 */
export function trackColor(
  trackId: string | null | undefined,
  explicit?: string | null,
  orderedTrackIds?: readonly string[] | null,
  untrackedTint?: string | null,
): string {
  if (explicit) return explicit;
  if (!trackId) return untrackedTint || "var(--gray-300)";
  if (orderedTrackIds && orderedTrackIds.length > 0 && orderedTrackIds.length <= TRACK_COUNT) {
    const idx = orderedTrackIds.indexOf(trackId);
    if (idx >= 0) return `var(--track-${idx + 1})`;
  }
  return `var(--track-${(hashString(trackId) % TRACK_COUNT) + 1})`;
}
