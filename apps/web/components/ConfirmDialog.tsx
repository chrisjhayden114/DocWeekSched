import { useEffect, useId, useRef } from "react";

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  /** Plain description; can include the person’s name / consequences. */
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger = red confirm for destructive actions */
  tone?: "danger" | "default";
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
};

/**
 * Shared confirmation for ALL destructive actions.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  busy,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="modal-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="text-display-sm" style={{ margin: "0 0 var(--space-3)" }}>
          {title}
        </h2>
        <p className="text-body-md" style={{ margin: "0 0 var(--space-5)", color: "var(--ink-secondary)" }}>
          {body}
        </p>
        <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button ref={cancelRef} type="button" className="button secondary" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={tone === "danger" ? "button button-danger" : "button"}
            disabled={busy}
            onClick={() => void onConfirm()}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
