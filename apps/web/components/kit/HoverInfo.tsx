import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Portal } from "./Portal";
import { useAnchoredPopup } from "./useAnchoredPopup";

const OPEN_DELAY_MS = 400;
const POPOVER_MAX_WIDTH = 320;

export type HoverInfoProps = {
  title: string;
  body: string;
  appearsIn?: string;
  imageSrc?: string;
  children?: ReactNode;
};

function canHover(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(hover: hover)").matches
    : false;
}

/**
 * K-1 — calm info popover. Opens on hover (400ms) or keyboard focus (immediate);
 * the ⓘ trigger is the tap target on touch. Consumes useAnchoredPopup + Portal
 * as-is. Content rollout (appearsIn, screenshots) is K-2.
 */
export function HoverInfo({ title, body, appearsIn, imageSrc, children }: HoverInfoProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | null>(null);
  const tooltipId = useId();

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

  useEffect(() => () => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
        triggerRef.current?.focus();
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

  return (
    <span
      className="hover-info"
      ref={wrapRef}
      onMouseEnter={() => {
        if (canHover()) scheduleOpen();
      }}
      onMouseLeave={() => {
        if (canHover()) close();
      }}
    >
      {children}
      <button
        ref={triggerRef}
        type="button"
        className="hover-info-trigger"
        aria-label={`About ${title}`}
        aria-describedby={open ? tooltipId : undefined}
        onFocus={openNow}
        onBlur={(event) => {
          const next = event.relatedTarget as Node | null;
          if (popupRef.current?.contains(next) || wrapRef.current?.contains(next)) return;
          close();
        }}
        onClick={() => {
          if (openTimer.current) window.clearTimeout(openTimer.current);
          setOpen((value) => !value);
        }}
      >
        ⓘ
      </button>
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
          </div>
        </Portal>
      ) : null}
    </span>
  );
}
