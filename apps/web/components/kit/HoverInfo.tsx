import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from "react";
import { Portal } from "./Portal";
import { useAnchoredPopup } from "./useAnchoredPopup";

const OPEN_DELAY_MS = 400;
const POPOVER_MAX_WIDTH = 320;

export type HoverInfoTrigger = "icon" | "label";

export type HoverInfoProps = {
  title: string;
  body: string;
  appearsIn?: string;
  imageSrc?: string;
  children?: ReactNode;
  /**
   * `label` — the wrapped title is the trigger (cursor: help, dotted underline
   * on hover). No ⓘ on hover-capable devices. Touch taps the title.
   * `icon` — K-1 default: a visible ⓘ button beside the children.
   */
  trigger?: HoverInfoTrigger;
  /** Extra popover row (e.g. “Read the full guide →”). */
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

/**
 * K-1 / K-2.1 — calm info popover. Opens on hover (400ms) or keyboard focus
 * (immediate). `trigger="label"` makes the title itself the trigger.
 */
export function HoverInfo({
  title,
  body,
  appearsIn,
  imageSrc,
  children,
  trigger = "icon",
  action,
  hideIcon,
}: HoverInfoProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLElement>(null);
  const iconRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | null>(null);
  const tooltipId = useId();
  const labelMode = trigger === "label";
  const showIcon = !hideIcon && !labelMode;

  const close = useCallback(() => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    setOpen(false);
  }, []);

  const openNow = useCallback(() => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    setOpen(true);
  }, []);

  const scheduleOpen = useCallback(() => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(() => setOpen(true), OPEN_DELAY_MS);
  }, []);

  useEffect(
    () => () => {
      if (openTimer.current) window.clearTimeout(openTimer.current);
    },
    [],
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

  const popupStyle = useAnchoredPopup({
    open,
    triggerRef,
    popupRef,
    align: "start",
    maxWidth: POPOVER_MAX_WIDTH,
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
        if (canHover()) close();
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
            if (openTimer.current) window.clearTimeout(openTimer.current);
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
            if (openTimer.current) window.clearTimeout(openTimer.current);
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
            className="hover-info-popover"
            style={popupStyle}
            onMouseEnter={openNow}
            onMouseLeave={() => {
              if (canHover()) close();
            }}
          >
            <p className="hover-info-title">{title}</p>
            <p className="hover-info-body">{body}</p>
            {appearsIn ? <p className="hover-info-appears">Appears in: {appearsIn}</p> : null}
            {imageSrc ? <img className="hover-info-image" src={imageSrc} alt="" /> : null}
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
        </Portal>
      ) : null}
    </span>
  );
}
