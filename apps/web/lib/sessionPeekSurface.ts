/**
 * AGENDA-1 — which peek surface a session card opens.
 *
 * Pure so the "phones get the bottom sheet, desktops get the anchored popover"
 * rule is testable without a viewport. Anything narrow, or anything that cannot
 * hover (touch, pen), gets SessionPeekSheet: a popover anchored beside a card
 * has nowhere to go on a 390px screen, and there is no hover to keep it open.
 */

/** Below this the agenda is a single column — a beside-popover cannot fit. */
export const PEEK_POPOVER_MIN_WIDTH = 768;

export type PeekSurface = "popover" | "sheet";

export function peekSurfaceFor(viewportWidth: number, canHover: boolean): PeekSurface {
  return canHover && viewportWidth >= PEEK_POPOVER_MIN_WIDTH ? "popover" : "sheet";
}
