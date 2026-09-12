/**
 * W-1 — geometry for the portal-rendered popups (Select's listbox, KebabMenu's
 * panel). They render into document.body with position:fixed so no overflow
 * container can clip them, which means the placement CSS used to do has to be
 * computed from the trigger's rect instead. Pure, so the flip and clamp rules
 * are testable without a DOM.
 */

/** The subset of DOMRect the placement needs. */
export type AnchorRect = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
};

export type AnchorViewport = { width: number; height: number };

/**
 * Mirrors the CSS these popups used before the portal: "stretch" spanned the
 * trigger (.select-popup left/right: 0), "start" grew rightward from the
 * trigger's left edge (.select-compact), "end" hung off the trigger's right
 * edge (.kebab-panel).
 */
export type AnchorAlign = "stretch" | "start" | "end";

export type AnchorOptions = {
  align: AnchorAlign;
  /** Tallest the popup may be; the result never exceeds the free space either. */
  maxHeight?: number;
  /** Widest the popup may be. Ignored by "stretch", which matches the trigger. */
  maxWidth?: number;
  /** Distance between trigger and popup. */
  gap?: number;
  /** Clearance kept from the viewport edges. */
  margin?: number;
};

export type AnchorStyle = {
  position: "fixed";
  maxHeight: number;
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
};

export type AnchoredPopup = {
  placement: "below" | "above";
  style: AnchorStyle;
};

const GAP = 4;
const MARGIN = 8;
const MAX_HEIGHT = 260;
/** Beside placement sits further off the card than a dropdown sits off its trigger. */
const SIDE_GAP = 10;
/** Keep the caret away from the popup's rounded corners. */
const CARET_INSET = 18;
/** With less free space than this below the trigger the popup flips above it. */
const COMFORTABLE_HEIGHT = 160;
/** Floor so a cramped viewport yields a short scrolling popup, not none at all. */
const MIN_HEIGHT = 96;

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, high));
}

function horizontal(
  rect: AnchorRect,
  viewport: AnchorViewport,
  options: AnchorOptions,
  margin: number,
): Partial<AnchorStyle> {
  const cap = (available: number) =>
    options.maxWidth === undefined ? available : Math.min(options.maxWidth, available);

  if (options.align === "end") {
    const right = clamp(viewport.width - rect.right, margin, Math.max(margin, viewport.width - margin));
    return { right, maxWidth: cap(Math.max(0, viewport.width - margin - right)) };
  }

  const left = clamp(rect.left, margin, Math.max(margin, viewport.width - margin));
  if (options.align === "start") {
    return { left, minWidth: rect.width, maxWidth: cap(Math.max(0, viewport.width - margin - left)) };
  }

  const width = Math.min(rect.width, Math.max(0, viewport.width - margin * 2));
  return { left: clamp(rect.left, margin, Math.max(margin, viewport.width - margin - width)), width };
}

/**
 * Places a popup against its trigger in viewport coordinates: below when there
 * is room, flipped above when there is not, always inside the viewport.
 */
export function anchorPopup(
  rect: AnchorRect,
  viewport: AnchorViewport,
  options: AnchorOptions,
): AnchoredPopup {
  const gap = options.gap ?? GAP;
  const margin = options.margin ?? MARGIN;
  const ceiling = options.maxHeight ?? MAX_HEIGHT;

  const spaceBelow = Math.max(0, viewport.height - rect.bottom - gap - margin);
  const spaceAbove = Math.max(0, rect.top - gap - margin);
  const flip = spaceBelow < Math.min(ceiling, COMFORTABLE_HEIGHT) && spaceAbove > spaceBelow;
  const space = flip ? spaceAbove : spaceBelow;

  return {
    placement: flip ? "above" : "below",
    style: {
      position: "fixed",
      maxHeight: Math.max(Math.min(ceiling, MIN_HEIGHT), Math.min(ceiling, space)),
      ...(flip
        ? { bottom: Math.max(margin, viewport.height - rect.top + gap) }
        : { top: clamp(rect.bottom + gap, margin, Math.max(margin, viewport.height - margin)) }),
      ...horizontal(rect, viewport, options, margin),
    },
  };
}

/** Which side of the card the session peek popover landed on. */
export type BesidePlacement = "right" | "left" | "below" | "above";

export type BesideOptions = {
  /** Fixed popup width. Beside placement needs it up front to know if a side fits. */
  width: number;
  maxHeight: number;
  gap?: number;
  margin?: number;
};

export type AnchoredBesidePopup = {
  placement: BesidePlacement;
  style: AnchorStyle;
  /**
   * Distance from the popup's top edge to the caret's tip, so the caret keeps
   * pointing at the card after the vertical position is clamped. Undefined on
   * the below/above fallback, which renders no caret.
   */
  caretTop?: number;
};

/**
 * AGENDA-1 — places the session peek popover *beside* its card the way
 * sched.com does: to the right when the card has room on the right, flipped to
 * the left near the viewport's right edge, and only falling back to
 * below/above (via `anchorPopup`) when neither side fits — a narrow desktop
 * window, or a card in a full-width column.
 *
 * Pure, so the flip thresholds and the caret's clamped offset are testable
 * without a DOM.
 */
export function anchorBeside(
  rect: AnchorRect,
  viewport: AnchorViewport,
  options: BesideOptions,
): AnchoredBesidePopup {
  const gap = options.gap ?? SIDE_GAP;
  const margin = options.margin ?? MARGIN;
  const { width } = options;

  const roomRight = viewport.width - rect.right - gap - margin;
  const roomLeft = rect.left - gap - margin;
  const side: "right" | "left" | null =
    roomRight >= width ? "right" : roomLeft >= width ? "left" : null;

  if (!side) {
    // No side fits — a plain dropdown below/above the card, no caret.
    const { placement, style } = anchorPopup(rect, viewport, {
      align: "start",
      maxHeight: options.maxHeight,
      maxWidth: width,
      gap,
      margin,
    });
    return { placement, style };
  }

  const maxHeight = Math.min(options.maxHeight, Math.max(0, viewport.height - margin * 2));
  // Centre on the card, then clamp so the whole popup stays on screen.
  const cardMid = rect.top + (rect.bottom - rect.top) / 2;
  const top = clamp(cardMid - maxHeight / 2, margin, Math.max(margin, viewport.height - margin - maxHeight));
  // After clamping, the card may sit above or below the popup's midpoint, so
  // the caret follows the card rather than staying centred.
  const caretTop = clamp(cardMid - top, CARET_INSET, Math.max(CARET_INSET, maxHeight - CARET_INSET));

  return {
    placement: side,
    caretTop,
    style: {
      position: "fixed",
      maxHeight,
      top,
      width,
      maxWidth: width,
      ...(side === "right"
        ? { left: rect.right + gap }
        : { right: Math.max(margin, viewport.width - rect.left + gap) }),
    },
  };
}
