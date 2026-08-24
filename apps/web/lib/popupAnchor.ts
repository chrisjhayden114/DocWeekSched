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
