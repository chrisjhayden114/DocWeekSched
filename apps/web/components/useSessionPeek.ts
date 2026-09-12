/**
 * AGENDA-1 — one hook that turns any agenda card into a session peek trigger.
 *
 * It owns the parts that must agree across the public page, the in-app list,
 * the grid / by-room timetables and the pick-one board: hover intent, click to
 * pin, keyboard activation, only-one-open-at-a-time, and which surface opens
 * (anchored popover on desktop, bottom sheet on touch / narrow).
 *
 * Hover timings and the pointer-capability guard come from kit/HoverInfo so
 * every hover-to-open surface in the product feels identical.
 */

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { HOVER_INFO_CLOSE_GRACE_MS, HOVER_INFO_OPEN_DELAY_MS, canHover } from "./kit/HoverInfo";
import { peekSurfaceFor, type PeekSurface } from "../lib/sessionPeekSurface";

export type SessionPeekCardProps = {
  role?: "button";
  tabIndex?: 0;
  "aria-haspopup": "dialog";
  "aria-expanded": boolean;
  onMouseEnter: (event: MouseEvent<HTMLElement>) => void;
  onMouseLeave: () => void;
  onClick: (event: MouseEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
};

export type SessionPeek = {
  openId: string | null;
  /** Clicked or keyed open: hover-out no longer closes it. */
  pinned: boolean;
  /** Opened from the keyboard, so the surface should take focus. */
  autoFocus: boolean;
  surface: PeekSurface;
  /** The card the popover anchors to, and where Esc returns focus. */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Stable id for the peek title, for aria-labelledby. */
  titleId: string;
  close: () => void;
  /**
   * Props for a session card. `native` omits role/tabIndex for elements that
   * are already buttons (the timetable blocks).
   */
  getCardProps: (sessionId: string, opts?: { native?: boolean }) => SessionPeekCardProps;
  /** Wire these to the popover so a pointer crossing the gap keeps it open. */
  onPopoverPointerEnter: () => void;
  onPopoverPointerLeave: () => void;
};

function viewportWidth(): number {
  return typeof window === "undefined" ? 0 : window.innerWidth;
}

/**
 * Card click: the peek wins wherever it is wired, and the legacy behaviour
 * (usually router.push to the session page) only runs where it is not.
 *
 * This is why an in-app agenda card no longer navigates — the peek's
 * "Full details" is the deliberate way to the session page now.
 */
export function peekCardClick(
  peek: SessionPeekCardProps | undefined,
  fallback: (event: MouseEvent<HTMLElement>) => void,
): (event: MouseEvent<HTMLElement>) => void {
  return (event) => {
    if (peek) {
      peek.onClick(event);
      return;
    }
    fallback(event);
  };
}

/** Same rule for Enter/Space on a card that is not already a button. */
export function peekCardKeyDown(
  peek: SessionPeekCardProps | undefined,
  fallback: (event: KeyboardEvent<HTMLElement>) => void,
): (event: KeyboardEvent<HTMLElement>) => void {
  return (event) => {
    if (peek) {
      peek.onKeyDown(event);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fallback(event);
    }
  };
}

export function useSessionPeek(): SessionPeek {
  const [openId, setOpenId] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);
  const [autoFocus, setAutoFocus] = useState(false);
  const [surface, setSurface] = useState<PeekSurface>("popover");
  const anchorRef = useRef<HTMLElement | null>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  // Read inside handlers without making every card's props change identity.
  const pinnedRef = useRef(false);
  const titleId = useId();

  const clearTimers = useCallback(() => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const close = useCallback(() => {
    clearTimers();
    pinnedRef.current = false;
    setPinned(false);
    setAutoFocus(false);
    setOpenId(null);
  }, [clearTimers]);

  const scheduleClose = useCallback(() => {
    if (pinnedRef.current) return;
    if (openTimer.current) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setOpenId(null);
      setAutoFocus(false);
    }, HOVER_INFO_CLOSE_GRACE_MS);
  }, []);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const openNow = useCallback(
    (sessionId: string, anchor: HTMLElement | null, opts: { pin: boolean; focus: boolean; surface: PeekSurface }) => {
      clearTimers();
      if (anchor) anchorRef.current = anchor;
      pinnedRef.current = opts.pin;
      setSurface(opts.surface);
      setPinned(opts.pin);
      setAutoFocus(opts.focus);
      setOpenId(sessionId);
    },
    [clearTimers],
  );

  const getCardProps = useCallback(
    (sessionId: string, opts?: { native?: boolean }): SessionPeekCardProps => ({
      ...(opts?.native ? {} : { role: "button" as const, tabIndex: 0 as const }),
      "aria-haspopup": "dialog",
      "aria-expanded": openId === sessionId,
      onMouseEnter: (event) => {
        // No hover on touch, and a pinned popover is not something a passing
        // pointer gets to replace.
        if (!canHover() || pinnedRef.current) return;
        if (peekSurfaceFor(viewportWidth(), true) !== "popover") return;
        const anchor = event.currentTarget;
        cancelClose();
        if (openTimer.current) window.clearTimeout(openTimer.current);
        openTimer.current = window.setTimeout(() => {
          openTimer.current = null;
          anchorRef.current = anchor;
          setSurface("popover");
          setPinned(false);
          setAutoFocus(false);
          setOpenId(sessionId);
        }, HOVER_INFO_OPEN_DELAY_MS);
      },
      onMouseLeave: () => {
        if (!canHover()) return;
        scheduleClose();
      },
      onClick: (event) => {
        // A click anywhere inside a real control (Join, Star, a link) is that
        // control's, not the card's.
        if ((event.target as HTMLElement | null)?.closest("a,button,input,select,textarea")) return;
        if (openId === sessionId && pinnedRef.current) {
          close();
          return;
        }
        openNow(sessionId, event.currentTarget, {
          pin: true,
          focus: false,
          surface: peekSurfaceFor(viewportWidth(), canHover()),
        });
      },
      onKeyDown: (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        if ((event.target as HTMLElement | null) !== event.currentTarget) return;
        event.preventDefault();
        openNow(sessionId, event.currentTarget, {
          pin: true,
          focus: true,
          // Keyboard has no hover to speak of — the viewport alone decides.
          surface: peekSurfaceFor(viewportWidth(), true),
        });
      },
    }),
    [cancelClose, close, openId, openNow, scheduleClose],
  );

  const onPopoverPointerEnter = useCallback(() => {
    if (!canHover()) return;
    cancelClose();
  }, [cancelClose]);

  const onPopoverPointerLeave = useCallback(() => {
    if (!canHover()) return;
    scheduleClose();
  }, [scheduleClose]);

  return {
    openId,
    pinned,
    autoFocus,
    surface,
    anchorRef,
    titleId,
    close,
    getCardProps,
    onPopoverPointerEnter,
    onPopoverPointerLeave,
  };
}
