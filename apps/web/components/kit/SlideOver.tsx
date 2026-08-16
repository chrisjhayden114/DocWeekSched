import { kitCopy } from "@event-app/config";
import { ReactNode, useEffect, useId, useRef } from "react";

export type SlideOverProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  /** Sticky footer content — usually the action buttons. */
  footer?: ReactNode;
  /** 560px panel instead of the default 440px, for form-heavy content. */
  wide?: boolean;
  children: ReactNode;
};

/**
 * F1.2 #7 — the E30 drawer pattern generalized: right-anchored panel with
 * sticky header (title + close ✕), scrolling body, sticky footer. Reuses
 * the existing drawer-* surface (shadow-3, slide-in via the E28 motion
 * tokens, reduced-motion safe). Esc closes; focus lands on the close
 * button when the panel opens.
 */
export function SlideOver({ open, title, onClose, footer, wide, children }: SlideOverProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  /* Focus the close button ONLY when the panel transitions to open. This effect
   * must not depend on `onClose`: consumers often pass inline handlers whose
   * identity changes every render, and re-running this effect on each keystroke
   * steals focus from form fields (live-observed in the Readiness template
   * editor — one character per click). */
  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="drawer-backdrop" role="presentation" onClick={onClose} />
      <div
        className={wide ? "drawer-panel kit-slideover-wide" : "drawer-panel"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="drawer-header">
          <h3 id={titleId} className="text-h3" style={{ margin: 0 }}>
            {title}
          </h3>
          <button ref={closeRef} type="button" className="drawer-close" aria-label={kitCopy.slideOver.close} onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer ? <div className="drawer-footer">{footer}</div> : null}
      </div>
    </>
  );
}

/**
 * Progressive disclosure inside a SlideOver (F4's tool): essential fields
 * stay visible, advanced ones tuck behind "More options". Native
 * <details> keeps it keyboard-accessible for free.
 */
export function SlideOverMoreOptions({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <details className="kit-more-options">
      <summary>
        <svg
          className="kit-more-options-chevron"
          aria-hidden
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        {label ?? kitCopy.slideOver.moreOptions}
      </summary>
      <div className="kit-more-options-body">{children}</div>
    </details>
  );
}
