import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * E28.3 — segmented-control slide.
 *
 * Attach the returned ref to a segmented control whose direct children are a
 * `<span className="seg-slide" aria-hidden />` indicator followed by the
 * segment `<button>`s (the active one carrying `.active`). The indicator is
 * laid out over the active segment and, on change, slides to the new segment.
 *
 * Movement is transform-only (FLIP): the indicator's layout box is written
 * instantly with no transition, and only `transform` (translate + scale) ever
 * animates — width/height/left/top are never transitioned, so there is no
 * layout shift. After each slide the box is re-based onto the new segment and
 * the transform reset, so scale distortion exists only mid-flight.
 *
 * Reduced motion is honored twice over: the CSS transition runs on
 * `--motion-fast` (0ms under prefers-reduced-motion), and the hook also
 * checks the media query directly and repositions without animating.
 *
 * Until the first successful measurement the container has no
 * `data-seg-ready` attribute, so CSS keeps the plain `.active` background —
 * SSR and no-JS render exactly as before this chunk.
 */

type Rect = { left: number; top: number; width: number; height: number };

// useLayoutEffect avoids a one-frame flash of unstyled indicator on mount,
// but warns during SSR; fall back to useEffect on the server.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function measureActive(container: HTMLElement): Rect | null {
  const btn = container.querySelector<HTMLElement>(":scope > button.active");
  // offsetWidth 0 means the control is display:none (e.g. the schedule view
  // switcher below 768px) — skip and retry on resize.
  if (!btn || btn.offsetWidth === 0) return null;
  return { left: btn.offsetLeft, top: btn.offsetTop, width: btn.offsetWidth, height: btn.offsetHeight };
}

export function useSegmentSlide(active: unknown) {
  const ref = useRef<HTMLDivElement | null>(null);
  const baseRef = useRef<Rect | null>(null);
  const targetRef = useRef<Rect | null>(null);

  // Writes the indicator's layout box directly (transition suppressed for the
  // frame) and clears any transform. This is the only place left/top/width/
  // height change, and it is always instantaneous.
  const settle = (indicator: HTMLElement, container: HTMLElement, rect: Rect) => {
    baseRef.current = rect;
    indicator.style.transition = "none";
    indicator.style.left = `${rect.left}px`;
    indicator.style.top = `${rect.top}px`;
    indicator.style.width = `${rect.width}px`;
    indicator.style.height = `${rect.height}px`;
    indicator.style.transform = "";
    void indicator.offsetWidth; // flush styles so restoring the transition doesn't animate the jump
    indicator.style.transition = "";
    container.dataset.segReady = "true";
  };

  useIsoLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;
    const indicator = container.querySelector<HTMLElement>(":scope > .seg-slide");
    if (!indicator) return;
    const rect = measureActive(container);
    if (!rect) return;
    targetRef.current = rect;

    const base = baseRef.current;
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!base || reduced) {
      settle(indicator, container, rect);
      return;
    }
    if (base.left === rect.left && base.top === rect.top && base.width === rect.width && base.height === rect.height) {
      return;
    }

    // FLIP: box stays at `base`; transform carries it to the new segment.
    indicator.style.transform =
      `translate(${rect.left - base.left}px, ${rect.top - base.top}px) ` +
      `scale(${rect.width / base.width}, ${rect.height / base.height})`;
    // Re-base once the slide lands. targetRef (not the closure rect) so that
    // rapid toggling always settles on the latest segment.
    const onEnd = () => {
      if (targetRef.current) settle(indicator, container, targetRef.current);
    };
    indicator.addEventListener("transitionend", onEnd, { once: true });
    return () => indicator.removeEventListener("transitionend", onEnd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Segment widths depend on the viewport; reposition instantly on resize.
  useEffect(() => {
    const onResize = () => {
      const container = ref.current;
      if (!container) return;
      const indicator = container.querySelector<HTMLElement>(":scope > .seg-slide");
      const rect = measureActive(container);
      if (!indicator || !rect) return;
      targetRef.current = rect;
      settle(indicator, container, rect);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return ref;
}
