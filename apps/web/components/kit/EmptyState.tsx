import type { ReactNode } from "react";
import type { IconTone } from "./PageHeader";

export type EmptyStateProps = {
  /** An invitation, not an apology: "Start the conversation", never "Nothing here yet". */
  title: string;
  /** One line: what this area is for and where the action lives. */
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: ReactNode;
  iconTone?: IconTone;
};

/**
 * F1.2 #6 — the real empty state: soft tinted icon tile + inviting
 * headline + one-line body + optional CTA. Copy comes from the caller's
 * config module (emptyStateCopy et al.), per the CDS content guidance.
 */
export function EmptyState({ title, body, actionLabel, onAction, icon, iconTone = "primary" }: EmptyStateProps) {
  return (
    <div className="kit-empty">
      <span className={`kit-icon-tile kit-icon-tile--${iconTone}`} aria-hidden>
        {icon ?? (
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        )}
      </span>
      <h3 className="kit-empty-title">{title}</h3>
      <p className="kit-empty-body">{body}</p>
      {actionLabel && onAction ? (
        <button type="button" className="button kit-empty-action" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
