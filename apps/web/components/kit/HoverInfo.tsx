import { FEATURE_GUIDE, type FeatureKey } from "@event-app/shared";
import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from "react";
import { applyBrandTokens } from "../../lib/brandTokens";
import { featureGuideImage } from "../../lib/featureGuideImage";
import { GuidePanel } from "./GuidePanel";
import { Portal } from "./Portal";
import { useAnchoredPopup } from "./useAnchoredPopup";

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Wikipedia Page Previews: a short intent pause, then the card. */
export const HOVER_INFO_OPEN_DELAY_MS = 250;
/** Travel time between the trigger and the portaled card — do not close in this gap. */
export const HOVER_INFO_CLOSE_GRACE_MS = 150;
/** Extract height before the fade-out clip (15px × 1.5 × 6). */
export const HOVER_INFO_BODY_MIN_LINES = 2;
export const HOVER_INFO_BODY_LINES = 6;
export const HOVER_INFO_CARD_WIDTH = 400;
/** Card ceiling. Title + footer are reserved first; the body gets the remainder. */
export const HOVER_INFO_CARD_MAX_HEIGHT = 480;
export const HOVER_INFO_ART_HEIGHT = 140;
export const HOVER_INFO_GUIDE_ACTION = "How to use this feature →";

/** Warm a screenshot as soon as hover-intent starts, before the card mounts. */
export function preloadImage(src: string): void {
  if (!src || typeof window === "undefined") return;
  const img = new window.Image();
  img.src = src;
}

export type HoverInfoTrigger = "icon" | "label";

export type HoverInfoProps = {
  title: string;
  /** Omit when `featureKey` is set — the card then uses FEATURE_GUIDE.whatItDoes. */
  body?: string;
  appearsIn?: string;
  /** Future screenshot override; wins over `image` when set. */
  imageSrc?: string;
  /** Category art (or any decorative node) for the 16:9 top slot. */
  image?: ReactNode;
  children?: ReactNode;
  /**
   * `label` — the wrapped title is the trigger (dotted underline on hover;
   * the pointer stays the normal arrow). No ⓘ on hover-capable devices.
   * Touch taps the title.
   * `icon` — K-1 default: a visible ⓘ button beside the children.
   */
  trigger?: HoverInfoTrigger;
  /** Extra popover row (e.g. “How to use this feature →”). */
  action?: ReactNode;
  /**
   * When set, the footer is always “How to use this feature →” (unless
   * `action` is passed) and opens GuidePanel for this key.
   */
  featureKey?: FeatureKey;
  /** Never render ⓘ (Features page). Implied by trigger="label". */
  hideIcon?: boolean;
};

function canHover(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(hover: hover)").matches
    : false;
}

function isInteractiveElement(node: ReactNode): boolean {
  if (!isValidElement(node)) return false;
  if (typeof node.type === "string") {
    return node.type === "a" || node.type === "button";
  }
  const props = node.props as { href?: unknown; onClick?: unknown };
  return props.href != null || typeof props.onClick === "function";
}

/** True when the extract is taller than the 6-line window — Wikipedia fade. */
export function isFadeClipped(el: { scrollHeight: number; clientHeight: number }): boolean {
  return el.scrollHeight > el.clientHeight + 1;
}

/**
 * K-2.1 — Wikipedia-style page preview. Opens on hover (250ms) or keyboard
 * focus (immediate). Stays open while the pointer is over the trigger or the
 * card, with a 150ms grace gap between them. `trigger="label"` makes the
 * title itself the trigger.
 */
export function HoverInfo({
  title,
  body,
  appearsIn,
  imageSrc,
  image,
  children,
  trigger = "icon",
  action,
  featureKey,
  hideIcon,
}: HoverInfoProps) {
  const [open, setOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  const guide = featureKey ? FEATURE_GUIDE[featureKey] : undefined;
  const resolvedBody = body ?? (guide ? applyBrandTokens(guide.whatItDoes) : "");
  const resolvedImageSrc =
    imageSrc ?? (body == null && featureKey ? featureGuideImage(featureKey) : undefined);
  const resolvedAction =
    action ??
    (featureKey ? (
      <button type="button" onClick={() => setGuideOpen(true)}>
        {HOVER_INFO_GUIDE_ACTION}
      </button>
    ) : null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLElement>(null);
  const iconRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLParagraphElement>(null);
  const [bodyEl, setBodyEl] = useState<HTMLParagraphElement | null>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const tooltipId = useId();
  const labelMode = trigger === "label";
  const showIcon = !hideIcon && !labelMode;
  const hasImage = Boolean(resolvedImageSrc || image);

  const clearTimers = useCallback(() => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);

  const close = useCallback(() => {
    clearTimers();
    setOpen(false);
  }, [clearTimers]);

  const openNow = useCallback(() => {
    if (resolvedImageSrc) preloadImage(resolvedImageSrc);
    clearTimers();
    setOpen(true);
  }, [clearTimers, resolvedImageSrc]);

  const scheduleOpen = useCallback(() => {
    if (resolvedImageSrc) preloadImage(resolvedImageSrc);
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (openTimer.current) window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null;
      setOpen(true);
    }, HOVER_INFO_OPEN_DELAY_MS);
  }, [resolvedImageSrc]);

  const scheduleClose = useCallback(() => {
    if (openTimer.current) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
    }, HOVER_INFO_CLOSE_GRACE_MS);
  }, []);

  useEffect(
    () => () => {
      clearTimers();
    },
    [clearTimers],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
        (triggerRef.current ?? iconRef.current)?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const attachBody = useCallback((el: HTMLParagraphElement | null) => {
    bodyRef.current = el;
    setBodyEl(el);
  }, []);

  useIsomorphicLayoutEffect(() => {
    if (!bodyEl) {
      setClipped(false);
      return;
    }
    const measure = () => setClipped(isFadeClipped(bodyEl));
    measure();
    window.addEventListener("resize", measure);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(bodyEl);
    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [bodyEl]);

  const popupStyle = useAnchoredPopup({
    open,
    triggerRef,
    popupRef,
    align: "start",
    maxWidth: HOVER_INFO_CARD_WIDTH,
    maxHeight: HOVER_INFO_CARD_MAX_HEIGHT,
    onClose: close,
  });

  // Children.count() is 1 for a plain string, but Children.only() throws unless
  // the child is a real element — that crashed the Participants tab after hydrate.
  const childList = Children.toArray(children);
  const onlyChild = childList.length === 1 && isValidElement(childList[0]) ? childList[0] : null;
  const interactiveLabel = labelMode && isInteractiveElement(onlyChild);
  const labelButton = labelMode && !interactiveLabel;

  function onBlur(event: FocusEvent<HTMLElement>) {
    const next = event.relatedTarget as Node | null;
    if (popupRef.current?.contains(next) || wrapRef.current?.contains(next)) return;
    close();
  }

  const className = ["hover-info", labelMode ? "hover-info--label" : "", hideIcon ? "hover-info--no-icon" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      className={className}
      ref={wrapRef}
      onMouseEnter={() => {
        if (canHover()) scheduleOpen();
      }}
      onMouseLeave={() => {
        if (canHover()) scheduleClose();
      }}
      onFocusCapture={labelMode ? openNow : undefined}
    >
      {labelButton ? (
        <button
          ref={triggerRef as { current: HTMLButtonElement | null }}
          type="button"
          className="hover-info-label"
          aria-label={`About ${title}`}
          aria-describedby={open ? tooltipId : undefined}
          onFocus={openNow}
          onBlur={onBlur}
          onClick={() => {
            clearTimers();
            setOpen((value) => !value);
          }}
        >
          {children ?? title}
        </button>
      ) : (
        <span
          ref={labelMode ? (triggerRef as { current: HTMLSpanElement | null }) : undefined}
          className={labelMode ? "hover-info-label-slot" : undefined}
        >
          {children}
        </span>
      )}
      {showIcon ? (
        <button
          ref={(el) => {
            iconRef.current = el;
            if (!labelMode) (triggerRef as { current: HTMLElement | null }).current = el;
          }}
          type="button"
          className="hover-info-trigger"
          aria-label={`About ${title}`}
          aria-describedby={open ? tooltipId : undefined}
          onFocus={openNow}
          onBlur={onBlur}
          onClick={() => {
            clearTimers();
            setOpen((value) => !value);
          }}
        >
          ⓘ
        </button>
      ) : null}
      {open && popupStyle ? (
        <Portal>
          <div
            id={tooltipId}
            ref={popupRef}
            role="tooltip"
            className={["hover-info-popover", hasImage ? "hover-info-popover--has-image" : ""]
              .filter(Boolean)
              .join(" ")}
            style={popupStyle}
            onMouseEnter={() => {
              if (canHover()) openNow();
            }}
            onMouseLeave={() => {
              if (canHover()) scheduleClose();
            }}
          >
            {hasImage ? (
              <div className="hover-info-art" data-hover-slot="art" aria-hidden>
                {resolvedImageSrc ? <img className="hover-info-image" src={resolvedImageSrc} alt="" /> : image}
              </div>
            ) : null}
            <div className="hover-info-inner">
              <p className="hover-info-title" data-hover-slot="title">
                {title}
              </p>
              <p
                ref={attachBody}
                data-hover-slot="body"
                className={["hover-info-body", clipped ? "is-clipped" : ""].filter(Boolean).join(" ")}
              >
                {resolvedBody}
              </p>
              {appearsIn ? <p className="hover-info-appears">Appears in: {appearsIn}</p> : null}
              {resolvedAction ? (
                <div
                  className="hover-info-action"
                  data-hover-slot="footer"
                  onClick={() => {
                    close();
                  }}
                >
                  {resolvedAction}
                </div>
              ) : null}
            </div>
          </div>
        </Portal>
      ) : null}
      {featureKey ? (
        <GuidePanel featureKey={guideOpen ? featureKey : null} open={guideOpen} onClose={() => setGuideOpen(false)} />
      ) : null}
    </span>
  );
}
