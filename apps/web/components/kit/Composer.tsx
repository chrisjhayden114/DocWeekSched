import { kitCopy } from "@event-app/config";
import { FormEvent, KeyboardEvent, useEffect, useReducer, useRef } from "react";
import { composerCanSubmit, composerInitialState, composerReduce } from "./composerState";

export type ComposerProps = {
  /** The collapsed invitation, e.g. "Start the conversation…" (copy from the caller's config). */
  collapsedLabel: string;
  /** Label on the primary submit button, e.g. "Post". */
  submitLabel: string;
  /** Placeholder inside the expanded textarea; defaults to the collapsed label. */
  placeholder?: string;
  cancelLabel?: string;
  rows?: number;
  /** Disables the actions and swaps the submit label while a send is in flight. */
  busy?: boolean;
  /** Called with the trimmed draft. When it resolves, the composer clears and collapses. */
  onSubmit: (value: string) => void | Promise<void>;
};

/**
 * F1.2 #2 — the content-first heart: creation collapses to one affordance
 * and expands only when invoked. Esc or Cancel collapses (the draft is
 * kept); a successful submit clears and collapses. State transitions live
 * in composerState.ts.
 */
export function Composer({
  collapsedLabel,
  submitLabel,
  placeholder,
  cancelLabel,
  rows = 3,
  busy,
  onSubmit,
}: ComposerProps) {
  const [state, dispatch] = useReducer(composerReduce, composerInitialState);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wasExpanded = useRef(false);

  // Focus follows the interaction: expanding focuses the input; collapsing
  // returns focus to the trigger so keyboard users never lose their place.
  useEffect(() => {
    if (state.expanded) {
      textareaRef.current?.focus();
    } else if (wasExpanded.current) {
      triggerRef.current?.focus();
    }
    wasExpanded.current = state.expanded;
  }, [state.expanded]);

  const submit = async () => {
    if (busy || !composerCanSubmit(state)) return;
    await onSubmit(state.value.trim());
    dispatch({ type: "submitted" });
  };

  if (!state.expanded) {
    return (
      <button
        ref={triggerRef}
        type="button"
        className="kit-composer-trigger"
        aria-expanded="false"
        onClick={() => dispatch({ type: "expand" })}
      >
        <svg
          aria-hidden
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
        {collapsedLabel}
      </button>
    );
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      dispatch({ type: "collapse" });
    }
  };

  const onFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit();
  };

  return (
    <form className="kit-composer-panel" onSubmit={onFormSubmit}>
      <textarea
        ref={textareaRef}
        className="textarea"
        rows={rows}
        placeholder={placeholder ?? collapsedLabel}
        value={state.value}
        disabled={busy}
        onChange={(e) => dispatch({ type: "change", value: e.target.value })}
        onKeyDown={onKeyDown}
      />
      <div className="kit-composer-actions">
        <button
          type="button"
          className="button ghost"
          disabled={busy}
          onClick={() => dispatch({ type: "collapse" })}
        >
          {cancelLabel ?? kitCopy.composer.cancel}
        </button>
        <button type="submit" className="button" disabled={busy || !composerCanSubmit(state)}>
          {busy ? kitCopy.composer.busy : submitLabel}
        </button>
      </div>
    </form>
  );
}
