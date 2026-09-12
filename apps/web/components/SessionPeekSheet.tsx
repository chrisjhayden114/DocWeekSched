/**
 * Session peek sheet (Chunk H4 / DESIGN_PHASE_H D6).
 *
 * The touch / narrow-viewport peek surface. Tapping a card opens this bottom
 * sheet with the session's essentials and real actions, so acting on a session
 * never navigates the agenda away. A11y mirrors kit/Lightbox: focus moves in on
 * open, Esc and backdrop click close, body scroll is locked, focus is restored
 * on close.
 *
 * AGENDA-1 — the body is now SessionPeekContent, shared with the desktop
 * SessionPeekPopover, so the two surfaces can never drift apart.
 */

import { useEffect, useId, useRef } from "react";
import { Portal } from "./kit/Portal";
import {
  SessionPeekContent,
  type AgendaJoinMode,
  type PeekSession,
  type SessionPeekContentProps,
} from "./SessionPeekContent";

export type { AgendaJoinMode, PeekSession };

export type SessionPeekSheetProps = Omit<SessionPeekContentProps, "session" | "titleId"> & {
  session: PeekSession | null; // null = closed
  onClose: () => void;
};

export function SessionPeekSheet({ session, onClose, ...content }: SessionPeekSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  // Ref so the open effect doesn't re-run (and steal focus) when the parent
  // re-renders with a fresh onClose identity.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const titleId = useId();
  const open = session !== null;

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sheetRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  if (!session) return null;

  return (
    <Portal>
      <div className="session-peek-backdrop" role="presentation" onClick={onClose}>
        <div
          ref={sheetRef}
          className="session-peek-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" className="session-peek-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
          <SessionPeekContent {...content} session={session} titleId={titleId} />
        </div>
      </div>
    </Portal>
  );
}
