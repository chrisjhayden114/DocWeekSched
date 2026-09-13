import { CSSProperties, RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AnchorAlign,
  anchorBeside,
  anchorPopup,
  type BesidePlacement,
} from "../../lib/popupAnchor";

/** The popups only open after hydration, but the module is imported during the
 *  server render, where useLayoutEffect warns. */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export type UseAnchoredPopupOptions = {
  open: boolean;
  /** Element the popup hangs off. Measured when the popup opens. */
  triggerRef: RefObject<HTMLElement | null>;
  /** The popup itself, so its own scrolling is not read as an outside scroll. */
  popupRef: RefObject<HTMLElement | null>;
  align: AnchorAlign;
  maxHeight?: number;
  maxWidth?: number;
  /** Called when the anchor goes stale — an outside scroll or a resize. */
  onClose: () => void;
};

/**
 * Close the popup when its anchor goes stale. The popup is fixed and detached
 * from the trigger, so anything that moves the trigger afterwards (an outside
 * scroll, a resize) closes it rather than leaving it stranded.
 */
function useStaleAnchorClose(
  open: boolean,
  popupRef: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const close = () => closeRef.current();
    const onScroll = (event: Event) => {
      const target = event.target as Node | null;
      if (target && popupRef.current?.contains(target)) return;
      close();
    };
    window.addEventListener("resize", close);
    // Capture phase: scroll events do not bubble, so a scrolling ancestor of the
    // trigger has to be caught on the way down.
    document.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open, popupRef]);
}

/**
 * W-1 — position for a popup rendered through kit/Portal. The trigger's rect is
 * read once per open; because the popup is fixed and detached from the trigger,
 * anything that moves the trigger afterwards (an outside scroll, a resize)
 * closes the popup rather than leaving it stranded.
 *
 * Returns undefined until the measurement lands, which is the caller's signal to
 * hold the popup back for that one render instead of flashing it at 0,0.
 */
export function useAnchoredPopup({
  open,
  triggerRef,
  popupRef,
  align,
  maxHeight,
  maxWidth,
  onClose,
}: UseAnchoredPopupOptions): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties>();

  useIsomorphicLayoutEffect(() => {
    if (!open) {
      setStyle(undefined);
      return;
    }
    const trigger = triggerRef.current;
    if (!trigger) return;
    const placed = anchorPopup(
      trigger.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
      { align, maxHeight, maxWidth },
    );
    setStyle(placed.style);
  }, [open, align, maxHeight, maxWidth, triggerRef]);

  useStaleAnchorClose(open, popupRef, onClose);

  return style;
}

export type UseAnchoredSidePopupOptions = {
  open: boolean;
  triggerRef: RefObject<HTMLElement | null>;
  popupRef: RefObject<HTMLElement | null>;
  width: number;
  maxHeight: number;
  onClose: () => void;
};

export type AnchoredSidePlacement = {
  style: CSSProperties;
  placement: BesidePlacement;
  /**
   * Caret offset inside the popup: from its top edge beside the trigger, from
   * its left edge on the below/above fallback.
   */
  caretOffset: number;
};

/** Same placement, down to the caret — nothing to re-render for. */
function samePlacement(a: AnchoredSidePlacement | undefined, b: AnchoredSidePlacement): boolean {
  if (!a || a.placement !== b.placement || a.caretOffset !== b.caretOffset) return false;
  const before = a.style as Record<string, unknown>;
  const after = b.style as Record<string, unknown>;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].every((key) => before[key] === after[key]);
}

/**
 * AGENDA-1 — the same portal-anchoring contract as `useAnchoredPopup`, but
 * placed *beside* the trigger (sched.com's session popover) instead of under
 * it, and returning the placement so the caller can point a caret at the card.
 *
 * Returns undefined until the measurement lands — hold the popup back for that
 * render rather than flashing it at 0,0.
 */
export function useAnchoredSidePopup({
  open,
  triggerRef,
  popupRef,
  width,
  maxHeight,
  onClose,
}: UseAnchoredSidePopupOptions): AnchoredSidePlacement | undefined {
  const [placed, setPlaced] = useState<AnchoredSidePlacement>();

  /*
   * UI-5 — the caret is clamped against the popup's real box, which only
   * exists after it has been painted once: pass one places the popup from the
   * height ceiling, pass two corrects it against what was drawn. Hence a
   * measurement on every commit rather than on `open` alone — it also catches
   * content that changes height under a popup already on screen — with an
   * unchanged result bailing out instead of looping.
   */
  useIsomorphicLayoutEffect(() => {
    if (!open) {
      setPlaced(undefined);
      return;
    }
    const trigger = triggerRef.current;
    if (!trigger) return;
    const popup = popupRef.current?.getBoundingClientRect();
    const result = anchorBeside(
      trigger.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
      { width, maxHeight, measured: popup && { width: popup.width, height: popup.height } },
    );
    const next: AnchoredSidePlacement = {
      style: result.style,
      placement: result.placement,
      caretOffset: result.caretOffset,
    };
    setPlaced((current) => (samePlacement(current, next) ? current : next));
  });

  useStaleAnchorClose(open, popupRef, onClose);

  return placed;
}
