import { kitCopy } from "@event-app/config";
import { FormEvent, KeyboardEvent, ReactNode, useEffect, useReducer, useRef } from "react";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { composerCanSubmit, composerInitialState, composerReduce } from "./composerState";

/** The live draft, passed to function children so context fields can read it. */
export type ComposerDraft = { title: string; body: string };

export type ComposerProps = {
  /** The collapsed invitation, e.g. "Start the conversation…" (copy from the caller's config). */
  collapsedLabel: string;
  /** Label on the primary submit button, e.g. "Post". */
  submitLabel: string;
  /** Placeholder inside the expanded textarea; defaults to the collapsed label. */
  placeholder?: string;
  cancelLabel?: string;
  /** Height floor for the body field, which grows past it as the draft does. */
  rows?: number;
  /** Disables the actions and swaps the submit label while a send is in flight. */
  busy?: boolean;
  /**
   * F3: renders a headline input above the body (community posts, Q&A
   * questions). When set, onSubmit receives the title. Title is required
   * only when `requireTitle` is true (default: a title field is showing).
   */
  titlePlaceholder?: string;
  /**
   * Community posts accept title-only, body-only, or photos (`allowEmptySubmit`).
   * Session Q&A still requires both a title and a body.
   */
  requireTitle?: boolean;
  /**
   * F3: inline error from the caller (validation or a failed send) —
   * rendered inside the panel, never window.alert.
   */
  error?: string | null;
  /**
   * F3: context-specific fields inside the expanded panel (e.g. the
   * community channel fields). A function child receives the live draft.
   */
  children?: ReactNode | ((draft: ComposerDraft) => ReactNode);
  /**
   * Optional external control of the expansion, so a header action or an
   * EmptyState CTA can open the composer. Omit for the self-managed default.
   */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** When true, submit is allowed even with empty title/body — the caller has other
   *  postable content (e.g. a MOMENTS post that is only an uploaded photo). */
  allowEmptySubmit?: boolean;
  /**
   * Called with the trimmed draft (body, then title). When it resolves, the
   * composer clears and collapses; if it THROWS, the draft is kept and the
   * panel stays open so the caller can surface `error`.
   */
  onSubmit: (value: string, title: string) => void | Promise<void>;
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
  titlePlaceholder,
  requireTitle: requireTitleProp,
  error,
  children,
  expanded: expandedProp,
  onExpandedChange,
  allowEmptySubmit,
  onSubmit,
}: ComposerProps) {
  const [state, dispatch] = useReducer(composerReduce, composerInitialState);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wasExpanded = useRef(false);

  // Optional external control: sync the reducer to the prop. The draft
  // itself always lives in the reducer, so collapsing externally still
  // keeps a half-written post.
  useEffect(() => {
    if (typeof expandedProp !== "boolean") return;
    dispatch({ type: expandedProp ? "expand" : "collapse" });
  }, [expandedProp]);

  const setExpanded = (next: boolean) => {
    dispatch({ type: next ? "expand" : "collapse" });
    onExpandedChange?.(next);
  };

  // Focus follows the interaction: expanding focuses the first input;
  // collapsing returns focus to the trigger so keyboard users never lose
  // their place.
  useEffect(() => {
    if (state.expanded) {
      (titleRef.current ?? textareaRef.current)?.focus();
    } else if (wasExpanded.current) {
      triggerRef.current?.focus();
    }
    wasExpanded.current = state.expanded;
  }, [state.expanded]);

  const requireTitle = requireTitleProp ?? Boolean(titlePlaceholder);

  const submit = async () => {
    if (busy || !composerCanSubmit(state, { requireTitle, allowEmpty: allowEmptySubmit })) return;
    try {
      await onSubmit(state.value.trim(), state.title.trim());
    } catch {
      // The caller surfaces the failure via `error`; the draft is kept.
      return;
    }
    dispatch({ type: "submitted" });
    onExpandedChange?.(false);
  };

  if (!state.expanded) {
    return (
      <button
        ref={triggerRef}
        type="button"
        className="kit-composer-trigger"
        aria-expanded="false"
        onClick={() => setExpanded(true)}
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

  const onFieldKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      setExpanded(false);
    }
  };

  const onFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit();
  };

  return (
    <form className="kit-composer-panel" onSubmit={onFormSubmit}>
      {titlePlaceholder ? (
        <input
          ref={titleRef}
          className="input"
          placeholder={titlePlaceholder}
          aria-label={titlePlaceholder}
          value={state.title}
          disabled={busy}
          onChange={(e) => dispatch({ type: "changeTitle", value: e.target.value })}
          onKeyDown={onFieldKeyDown}
        />
      ) : null}
      <AutoGrowTextarea
        ref={textareaRef}
        className="textarea"
        minRows={rows}
        placeholder={placeholder ?? collapsedLabel}
        aria-label={placeholder ?? collapsedLabel}
        value={state.value}
        disabled={busy}
        onChange={(e) => dispatch({ type: "change", value: e.target.value })}
        onKeyDown={onFieldKeyDown}
      />
      {typeof children === "function" ? children({ title: state.title, body: state.value }) : children}
      {error ? (
        <p className="kit-composer-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="kit-composer-actions">
        <button type="button" className="button ghost" disabled={busy} onClick={() => setExpanded(false)}>
          {cancelLabel ?? kitCopy.composer.cancel}
        </button>
        <button
          type="submit"
          className="button"
          disabled={busy || !composerCanSubmit(state, { requireTitle, allowEmpty: allowEmptySubmit })}
        >
          {busy ? kitCopy.composer.busy : submitLabel}
        </button>
      </div>
    </form>
  );
}
