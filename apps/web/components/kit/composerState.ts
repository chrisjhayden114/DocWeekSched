/**
 * F1.2 #2 — Composer collapse/expand contract, extracted as a pure state
 * machine so the behavior is testable in the node suite
 * (__tests__/patternKit.test.ts) the way lib/selectControl is.
 *
 * The rules:
 * - "expand" opens the full input.
 * - "collapse" (Esc or Cancel) closes it but KEEPS the draft — closing a
 *   composer must never destroy someone's half-written post.
 * - "submitted" (successful send) clears the draft and collapses.
 *
 * F3 adds an optional headline: posts and questions carry a title next to
 * the body. It rides the same contract — kept on collapse, cleared on
 * submit — and is only required when the screen renders a title field.
 */
export type ComposerState = {
  expanded: boolean;
  value: string;
  title: string;
};

export type ComposerEvent =
  | { type: "expand" }
  | { type: "change"; value: string }
  | { type: "changeTitle"; value: string }
  | { type: "collapse" }
  | { type: "submitted" };

export const composerInitialState: ComposerState = { expanded: false, value: "", title: "" };

export function composerReduce(state: ComposerState, event: ComposerEvent): ComposerState {
  switch (event.type) {
    case "expand":
      return state.expanded ? state : { ...state, expanded: true };
    case "change":
      return { ...state, value: event.value };
    case "changeTitle":
      return { ...state, title: event.value };
    case "collapse":
      return state.expanded ? { ...state, expanded: false } : state;
    case "submitted":
      return { expanded: false, value: "", title: "" };
  }
}

/**
 * Submit is allowed only from the expanded state with a non-blank draft —
 * and a non-blank title where the screen asks for one.
 */
export function composerCanSubmit(
  state: ComposerState,
  options?: { requireTitle?: boolean; allowEmpty?: boolean },
): boolean {
  if (!state.expanded) return false;
  if (options?.allowEmpty) return true;
  if (state.value.trim().length === 0) return false;
  if (options?.requireTitle && state.title.trim().length === 0) return false;
  return true;
}
