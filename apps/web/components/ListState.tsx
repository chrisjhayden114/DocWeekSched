import type { ReactNode } from "react";

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="list-skeleton" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="list-skeleton-row" />
      ))}
    </div>
  );
}

export function ListEmpty({
  title,
  body,
  actionLabel,
  onAction,
  icon,
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: ReactNode;
}) {
  return (
    <div className="list-empty">
      <span className="list-empty-icon" aria-hidden>
        {icon ?? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 12h-6l-2 3h-4l-2-3H2" />
            <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
          </svg>
        )}
      </span>
      <h3 className="text-h3" style={{ margin: "0 0 var(--space-1)" }}>
        {title}
      </h3>
      <p className="text-body" style={{ margin: "0 0 var(--space-4)", color: "var(--meta-color)" }}>
        {body}
      </p>
      {actionLabel && onAction ? (
        <button type="button" className="button secondary" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

export function ListError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="list-error">
      <p className="text-body" style={{ margin: 0, color: "var(--danger)" }}>
        {message}
      </p>
      {onRetry ? (
        <button type="button" className="button secondary" style={{ marginTop: "var(--space-3)" }} onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}
