import { typedConfirmationMatches } from "@event-app/shared";
import { useEffect, useId, useRef, useState } from "react";
import { AutoGrowTextarea } from "./kit/AutoGrowTextarea";

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
  /** Optional reason / note field (ER4 reject). */
  promptLabel?: string;
  promptValue?: string;
  promptPlaceholder?: string;
  promptRequired?: boolean;
  onPromptChange?: (value: string) => void;
  /**
   * ORG-2 — typed confirmation for the acts that cannot be undone. Set the
   * phrase the person has to type (an organization's name, not a fixed word, so
   * an organizer with several proves which one they mean) and Confirm stays
   * disabled until it matches. The server checks the same phrase; this is the
   * pause, not the guarantee.
   */
  typedConfirmExpected?: string;
  typedConfirmLabel?: string;
  typedConfirmValue?: string;
  onTypedConfirmChange?: (value: string) => void;
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
  promptLabel,
  promptValue,
  promptPlaceholder,
  promptRequired,
  onPromptChange,
  typedConfirmExpected,
  typedConfirmLabel,
  typedConfirmValue,
  onTypedConfirmChange,
}: ConfirmDialogProps) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  // E28.3 — close reverses: after `open` flips false the dialog stays mounted
  // with .is-closing (reversed fade/scale keyframes) until the backdrop's
  // animation ends. Under prefers-reduced-motion the animation completes in
  // one imperceptible frame, so `animationend` still fires and close is
  // effectively instant.
  const [closing, setClosing] = useState(false);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      setClosing(false);
    } else if (wasOpen.current) {
      wasOpen.current = false;
      setClosing(true);
    }
  }, [open]);

  /* Focus cancel ONLY when the dialog transitions to open. Do not depend on
   * `onCancel`: consumers often pass inline handlers whose identity changes
   * every render (e.g. reject-reason keystrokes), and re-running focus steals
   * the caret from the prompt textarea — same disease as the ER3a SlideOver. */
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open && !closing) return null;

  return (
    <div
      className={closing ? "modal-backdrop is-closing" : "modal-backdrop"}
      role="presentation"
      onClick={open ? onCancel : undefined}
      onAnimationEnd={(e) => {
        if (closing && e.target === e.currentTarget) setClosing(false);
      }}
    >
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
        {promptLabel ? (
          <label style={{ display: "grid", gap: 6, margin: "0 0 var(--space-5)" }}>
            <span className="text-body-md">{promptLabel}</span>
            <AutoGrowTextarea
              className="input"
              minRows={3}
              value={promptValue ?? ""}
              placeholder={promptPlaceholder}
              required={promptRequired}
              onChange={(e) => onPromptChange?.(e.target.value)}
              style={{ fontSize: 16 }}
            />
          </label>
        ) : null}
        {typedConfirmExpected ? (
          <label style={{ display: "grid", gap: 6, margin: "0 0 var(--space-5)" }}>
            <span className="text-body-md">
              {typedConfirmLabel ?? `Type ${typedConfirmExpected} to confirm`}
            </span>
            <input
              className="input"
              autoComplete="off"
              spellCheck={false}
              value={typedConfirmValue ?? ""}
              placeholder={typedConfirmExpected}
              onChange={(e) => onTypedConfirmChange?.(e.target.value)}
              style={{ fontSize: 16 }}
            />
          </label>
        ) : null}
        <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button ref={cancelRef} type="button" className="button secondary" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={tone === "danger" ? "button button-danger" : "button"}
            disabled={
              busy ||
              (promptRequired && !promptValue?.trim()) ||
              (typedConfirmExpected != null &&
                !typedConfirmationMatches(typedConfirmValue ?? "", typedConfirmExpected))
            }
            onClick={() => void onConfirm()}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
