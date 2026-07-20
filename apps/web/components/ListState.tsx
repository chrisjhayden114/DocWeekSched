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
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="list-empty">
      <h3 className="text-display-sm" style={{ margin: "0 0 var(--space-2)" }}>
        {title}
      </h3>
      <p className="text-body-md" style={{ margin: "0 0 var(--space-4)", color: "var(--ink-secondary)" }}>
        {body}
      </p>
      {actionLabel && onAction ? (
        <button type="button" className="button" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

export function ListError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="list-error">
      <p className="text-body-md" style={{ margin: 0, color: "var(--danger-700)" }}>
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
