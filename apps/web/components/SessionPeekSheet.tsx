/**
 * Session peek sheet (Chunk H4 / DESIGN_PHASE_H D6).
 *
 * Tapping a Grid / By-room cell opens this bottom sheet with the session's
 * essentials and real actions, so acting on a session never navigates the
 * timetable away. A11y mirrors kit/Lightbox: focus moves in on open, Esc and
 * backdrop click close, body scroll is locked, focus is restored on close.
 *
 * Deliberately no Like action here — the sheet stays minimal; Like lives on
 * the List-view cards and the session detail page.
 */

import { useEffect, useRef, useState } from "react";
import { Portal } from "./kit/Portal";
import { peekMeta, peekSpeakers } from "../lib/sessionPeek";

type AgendaJoinMode = "VIRTUAL" | "IN_PERSON" | "ASYNC";

export type PeekSession = {
  id: string;
  title: string;
  description?: string;
  location?: string | null;
  room?: { id: string; name: string } | null;
  track?: { id: string; name: string; color?: string } | null;
  speakers?: string | null;
  speaker?: { name: string };
  startsAt: string;
  endsAt: string;
  allowVirtualJoin?: boolean | null;
};

export type SessionPeekSheetProps = {
  session: PeekSession | null; // null = closed
  timeZone: string;
  joined: boolean;
  joinMode?: AgendaJoinMode | null;
  starred: boolean;
  joinBusy: boolean;
  onClose: () => void;
  /** SINGLE-STEP join (patches IN_PERSON directly). Resolve false to surface the inline error. */
  onJoin: () => Promise<boolean | void> | void;
  onLeave: () => Promise<boolean | void> | void;
  onChangeMode: (mode: AgendaJoinMode) => Promise<boolean | void> | void;
  onToggleStar: () => void;
  onOpenDetails: () => void;
};

export function SessionPeekSheet({
  session,
  timeZone,
  joined,
  joinMode,
  starred,
  joinBusy,
  onClose,
  onJoin,
  onLeave,
  onChangeMode,
  onToggleStar,
  onOpenDetails,
}: SessionPeekSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  // Ref so the open effect doesn't re-run (and steal focus) when the parent
  // re-renders with a fresh onClose identity.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const [error, setError] = useState<string | null>(null);
  const open = session !== null;
  const sessionId = session?.id;

  useEffect(() => {
    setError(null);
  }, [sessionId]);

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

  const run = async (action: () => Promise<boolean | void> | void) => {
    setError(null);
    const ok = await action();
    if (ok === false) setError("Couldn't save — try again");
  };

  const myMode: AgendaJoinMode = joinMode ?? "IN_PERSON";
  const allowsVirtual = session.allowVirtualJoin !== false;
  const meta = peekMeta(session, timeZone);
  const speakers = peekSpeakers(session);

  return (
    <Portal>
      <div className="session-peek-backdrop" role="presentation" onClick={onClose}>
        <div
          ref={sheetRef}
          className="session-peek-sheet"
          role="dialog"
          aria-modal="true"
          aria-label={session.title}
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="session-peek-head">
            <h3 className="session-peek-title">{session.title}</h3>
            <button type="button" className="session-peek-close" aria-label="Close" onClick={onClose}>
              ×
            </button>
          </div>
          <p className="session-peek-meta">{meta}</p>
          {speakers ? <p className="session-peek-speakers">{speakers}</p> : null}
          {session.description ? <p className="session-peek-desc">{session.description}</p> : null}
          {error ? (
            <p className="session-peek-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="session-peek-actions">
            {!joined ? (
              <button
                type="button"
                className="button session-peek-join"
                disabled={joinBusy}
                onClick={() => void run(onJoin)}
              >
                Join · adds to My Schedule
              </button>
            ) : (
              <>
                <span className="session-peek-joined-pill">Joined ✓</span>
                <button
                  type="button"
                  className="session-peek-leave"
                  disabled={joinBusy}
                  onClick={() => void run(onLeave)}
                >
                  Leave
                </button>
              </>
            )}
            <button
              type="button"
              className={`button secondary session-peek-star${starred ? " is-active" : ""}`}
              aria-pressed={starred}
              title={starred ? "Remove star (session starting soon alerts)" : "Star for reminders"}
              onClick={onToggleStar}
            >
              {starred ? "Starred" : "Star"}
            </button>
          </div>
          {joined ? (
            <div className="join-mode-switch session-peek-mode" role="group" aria-label="Attendance mode">
              {allowsVirtual && (
                <button
                  type="button"
                  className={myMode === "VIRTUAL" ? "is-active" : ""}
                  disabled={joinBusy}
                  onClick={() => void run(() => onChangeMode("VIRTUAL"))}
                >
                  Virtual
                </button>
              )}
              <button
                type="button"
                className={myMode === "IN_PERSON" ? "is-active" : ""}
                disabled={joinBusy}
                onClick={() => void run(() => onChangeMode("IN_PERSON"))}
              >
                In person
              </button>
              <button
                type="button"
                className={myMode === "ASYNC" ? "is-active" : ""}
                disabled={joinBusy}
                title="Asynchronous — join across time zones"
                onClick={() => void run(() => onChangeMode("ASYNC"))}
              >
                Async
              </button>
            </div>
          ) : null}
          <button type="button" className="session-peek-details" onClick={onOpenDetails}>
            Full details →
          </button>
        </div>
      </div>
    </Portal>
  );
}
