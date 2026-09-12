/**
 * AGENDA-1 — the desktop session peek: a non-modal popover anchored beside the
 * agenda card, the way sched.com's session popover works.
 *
 * Non-modal on purpose. The agenda stays readable and scannable behind it: no
 * backdrop, no body scroll lock, no focus imprisonment until the attendee has
 * actually asked for it by clicking or pressing Enter. Hover opens it after an
 * intent pause; a click pins it, and only then do Esc / outside click / the X
 * matter.
 *
 * Touch and narrow viewports never see this — they get SessionPeekSheet with
 * the same SessionPeekContent (see lib/sessionPeekSurface).
 */

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Portal } from "./kit/Portal";
import { useAnchoredSidePopup } from "./kit/useAnchoredPopup";

/** Fixed popover width — wide enough for a speaker row without crowding the agenda. */
export const PEEK_POPOVER_WIDTH = 420;
/** Ceiling; the body scrolls inside it. */
export const PEEK_POPOVER_MAX_HEIGHT = 560;

/** min(70vh, 560px) — tall enough to be useful, short enough to stay beside the card. */
export function peekPopoverMaxHeight(viewportHeight: number): number {
  return Math.min(Math.round(viewportHeight * 0.7), PEEK_POPOVER_MAX_HEIGHT);
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export type SessionPeekPopoverProps = {
  open: boolean;
  /** The card the popover hangs off. Focus returns here on Esc. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Matches the id SessionPeekContent puts on its <h3>. */
  titleId: string;
  /** Pinned by a click or a keypress — hover-out no longer closes it. */
  pinned?: boolean;
  /** Opened from the keyboard: move focus into the popover. */
  autoFocus?: boolean;
  onClose: () => void;
  /** Pointer moved into the popover — cancel the pending close. */
  onPointerEnter?: () => void;
  /** Pointer left the popover — start the close grace period. */
  onPointerLeave?: () => void;
  children: ReactNode;
};

export function SessionPeekPopover({
  open,
  anchorRef,
  titleId,
  pinned = false,
  autoFocus = false,
  onClose,
  onPointerEnter,
  onPointerLeave,
  children,
}: SessionPeekPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Ref so the open effect doesn't re-run (and steal focus) when the parent
  // re-renders with a fresh onClose identity — same bug SessionPeekSheet hit.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const maxHeight =
    open && typeof window !== "undefined" ? peekPopoverMaxHeight(window.innerHeight) : PEEK_POPOVER_MAX_HEIGHT;

  const placed = useAnchoredSidePopup({
    open,
    triggerRef: anchorRef,
    popupRef: panelRef,
    width: PEEK_POPOVER_WIDTH,
    maxHeight,
    onClose,
  });

  const closeToAnchor = useCallback(() => {
    anchorRef.current?.focus?.();
    onCloseRef.current();
  }, [anchorRef]);

  /** Esc anywhere closes and hands focus back to the card. */
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      closeToAnchor();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closeToAnchor]);

  /** Outside click closes. The card itself is not "outside" — it owns the toggle. */
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onCloseRef.current();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, anchorRef]);

  /**
   * Keyboard opens move focus in; the pointer never steals it.
   *
   * Tracked as state (kit/HoverInfo does the same for its body) because the
   * panel reaches the DOM a commit after `open` flips: the measurement has to
   * land first, and kit/Portal mounts on its own layout effect. An effect keyed
   * on `open` alone would fire while panelRef is still null.
   */
  const [panelEl, setPanelEl] = useState<HTMLDivElement | null>(null);
  const attachPanel = useCallback((el: HTMLDivElement | null) => {
    panelRef.current = el;
    setPanelEl(el);
  }, []);

  useEffect(() => {
    if (!panelEl || !autoFocus) return;
    panelEl.focus();
  }, [panelEl, autoFocus]);

  if (!open || !placed) return null;

  const caretStyle = placed.caretTop === undefined ? undefined : { top: placed.caretTop };

  return (
    <Portal>
      <div
        ref={attachPanel}
        className={`session-peek-pop session-peek-pop--${placed.placement}`}
        style={placed.style}
        role="dialog"
        aria-modal={false}
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseEnter={onPointerEnter}
        onMouseLeave={onPointerLeave}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          // Cycle inside once focus is in here, so Tab never strands the
          // attendee back at the top of the agenda with the popover open.
          const nodes = [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
          if (nodes.length === 0) return;
          const first = nodes[0]!;
          const last = nodes[nodes.length - 1]!;
          const active = document.activeElement;
          if (event.shiftKey && (active === first || active === panelRef.current)) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        {caretStyle ? <span className="session-peek-pop-caret" style={caretStyle} aria-hidden /> : null}
        <button
          type="button"
          className="session-peek-close session-peek-pop-close"
          aria-label="Close"
          onClick={closeToAnchor}
        >
          ×
        </button>
        <div className="session-peek-pop-scroll">{children}</div>
        {/* Pinned popovers are dismissible surfaces; announce that quietly. */}
        {pinned ? <span className="sr-only">Press Escape to close</span> : null}
      </div>
    </Portal>
  );
}
