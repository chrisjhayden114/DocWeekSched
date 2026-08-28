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
import { Portal } from "./Portal";
import { useAnchoredPopup } from "./useAnchoredPopup";

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Wikipedia Page Previews: a short intent pause, then the card. */
export const HOVER_INFO_OPEN_DELAY_MS = 250;
/** Travel time between the trigger and the portaled card — do not close in this gap. */
export const HOVER_INFO_CLOSE_GRACE_MS = 150;
/** Extract height before the fade-out clip (15px × 1.5 × 6). */
export const HOVER_INFO_BODY_LINES = 6;
export const HOVER_INFO_CARD_WIDTH = 400;

export type HoverInfoTrigger = "icon" | "label";

export type HoverInfoProps = {
  title: string;
  body: string;
  appearsIn?: string;
  /** Future screenshot override; wins over `image` when set. */
  imageSrc?: string;
  /** Category art (or any decorative node) for the 16:9 top slot. */
  image?: ReactNode;
  children?: ReactNode;
  /**
   * `label` — the wrapped title is the trigger (cursor: help, dotted underline
   * on hover). No ⓘ on hover-capable devices. Touch taps the title.
   * `icon` — K-1 default: a visible ⓘ button beside the children.
   */
  trigger?: HoverInfoTrigger;
  /** Extra popover row (e.g. “How to use this feature →”). */
  action?: ReactNode;
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
  hideIcon,
}: HoverInfoProps) {
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
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
  const hasImage = Boolean(imageSrc || image);

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
    clearTimers();
    setOpen(true);
  }, [clearTimers]);

  const scheduleOpen = useCallback(() => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (openTimer.current) window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null;
      setOpen(true);
    }, HOVER_INFO_OPEN_DELAY_MS);
  }, []);

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
    onClose: close,
  });

  const onlyChild = Children.count(children) === 1 ? Children.only(children) : children;
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
              <div className="hover-info-art" aria-hidden>
                {imageSrc ? <img className="hover-info-image" src={imageSrc} alt="" /> : image}
              </div>
            ) : null}
            <div className="hover-info-inner">
              <p className="hover-info-title">{title}</p>
              <p
                ref={attachBody}
                className={["hover-info-body", clipped ? "is-clipped" : ""].filter(Boolean).join(" ")}
              >
                {body}
              </p>
              {appearsIn ? <p className="hover-info-appears">Appears in: {appearsIn}</p> : null}
              {action ? (
                <div
                  className="hover-info-action"
                  onClick={() => {
                    close();
                  }}
                >
                  {action}
                </div>
              ) : null}
            </div>
          </div>
        </Portal>
      ) : null}
    </span>
  );
}
