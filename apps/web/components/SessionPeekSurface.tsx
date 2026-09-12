/**
 * AGENDA-1 — renders whichever peek surface `useSessionPeek` chose, so no page
 * has to repeat the desktop/touch branch. One instance per agenda; the hook
 * guarantees one open peek at a time.
 */

import { SessionPeekContent, type PeekSession, type SessionPeekContentProps } from "./SessionPeekContent";
import { SessionPeekPopover } from "./SessionPeekPopover";
import { SessionPeekSheet } from "./SessionPeekSheet";
import type { SessionPeek } from "./useSessionPeek";

export type SessionPeekSurfaceProps = Omit<SessionPeekContentProps, "session" | "titleId"> & {
  peek: SessionPeek;
  /** The open session, or null when nothing is open. */
  session: PeekSession | null;
};

export function SessionPeekSurface({ peek, session, ...content }: SessionPeekSurfaceProps) {
  if (peek.surface === "sheet") {
    return <SessionPeekSheet {...content} session={session} onClose={peek.close} />;
  }
  return (
    <SessionPeekPopover
      open={session !== null}
      anchorRef={peek.anchorRef}
      titleId={peek.titleId}
      pinned={peek.pinned}
      autoFocus={peek.autoFocus}
      onClose={peek.close}
      onPointerEnter={peek.onPopoverPointerEnter}
      onPointerLeave={peek.onPopoverPointerLeave}
    >
      {session ? <SessionPeekContent {...content} session={session} titleId={peek.titleId} /> : null}
    </SessionPeekPopover>
  );
}
