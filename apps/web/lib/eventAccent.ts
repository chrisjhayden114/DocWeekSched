import type { CSSProperties } from "react";

/**
 * Chunk F1.5.3 — event-driven accent with contrast safety.
 *
 * An event's stored brandColor feeds the runtime accent variables
 * (--event-accent and friends) on the event shell (organizer console for that
 * event, public /e/[slug]). Organizers pick arbitrary colors, so the accent is
 * derived, not used raw: if the brand color is too light for white text on a
 * filled control, we darken it until WCAG AA (4.5:1) holds. A missing or
 * unparsable color falls back to a restrained blue-gray — never bright blue,
 * and never an unreadable CTA.
 */

export type EventAccent = {
  /** Fill for selected states / accent buttons; AA-readable with `on` text. */
  accent: string;
  /** Hover fill; also links on white (kept AA against white). */
  hover: string;
  /** Light tint for selected rows / chips on white. */
  tint: string;
  /** Text color on top of `accent`. */
  on: string;
};

/** WCAG AA for normal text — the floor for `on` text over `accent`. */
const MIN_CONTRAST = 4.5;

/**
 * The no-brand-color default: the restrained blue-gray already used by the
 * slate theme (tokens.css), not UKEDL blue. #475569 on white is ~7.5:1.
 */
export const NEUTRAL_EVENT_ACCENT: EventAccent = {
  accent: "#475569",
  hover: "#64748b",
  tint: "#f1f5f9",
  on: "#ffffff",
};

type Rgb = { r: number; g: number; b: number };

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

function parseHex(input: string | null | undefined): Rgb | null {
  if (!input) return null;
  const hex = input.trim().replace(/^#/, "");
  const full =
    /^[0-9a-fA-F]{3}$/.test(hex) ? hex.split("").map((c) => c + c).join("") :
    /^[0-9a-fA-F]{6}$/.test(hex) ? hex :
    null;
  if (!full) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function toHex({ r, g, b }: Rgb): string {
  const h = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  return {
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
  };
}

/** WCAG relative luminance. */
function luminance({ r, g, b }: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two hex colors (1–21). Exported for tests. */
export function contrastRatio(hexA: string, hexB: string): number {
  const a = parseHex(hexA);
  const b = parseHex(hexB);
  if (!a || !b) return 1;
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Derive the accessible accent set from a stored brand color.
 * Light colors are darkened until white text reaches AA; missing/invalid
 * colors get the neutral default.
 */
export function accentFromBrand(brandColor: string | null | undefined): EventAccent {
  const parsed = parseHex(brandColor);
  if (!parsed) return NEUTRAL_EVENT_ACCENT;

  // Darken in 8% steps toward black until white text is readable. Every color
  // reaches AA on the way to black; the iteration cap is just a hard stop.
  let base = parsed;
  for (let i = 0; i < 40 && contrastRatio(toHex(base), "#ffffff") < MIN_CONTRAST; i += 1) {
    base = mix(base, BLACK, 0.08);
  }
  if (contrastRatio(toHex(base), "#ffffff") < MIN_CONTRAST) return NEUTRAL_EVENT_ACCENT;

  // Hover lifts toward white (matching the primary → primary-600 convention)
  // but never below AA against white, since hover also colors links on white.
  const lifted = mix(base, WHITE, 0.14);
  const hover = contrastRatio(toHex(lifted), "#ffffff") >= MIN_CONTRAST ? lifted : base;

  return {
    accent: toHex(base),
    hover: toHex(hover),
    tint: toHex(mix(base, WHITE, 0.92)),
    on: "#ffffff",
  };
}

/**
 * The inline style that scopes an event's accent to its shell:
 * `<div style={eventAccentStyle(event.brandColor)}>`.
 */
export function eventAccentStyle(brandColor: string | null | undefined): CSSProperties {
  const a = accentFromBrand(brandColor);
  return {
    "--event-accent": a.accent,
    "--event-accent-hover": a.hover,
    "--event-accent-tint": a.tint,
    "--event-accent-on": a.on,
  } as CSSProperties;
}
