import { CSSProperties, RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnchorAlign, anchorPopup } from "../../lib/popupAnchor";

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
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

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

  return style;
}
