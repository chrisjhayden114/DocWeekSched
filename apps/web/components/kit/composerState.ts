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
 */
export type ComposerState = {
  expanded: boolean;
  value: string;
};

export type ComposerEvent =
  | { type: "expand" }
  | { type: "change"; value: string }
  | { type: "collapse" }
  | { type: "submitted" };

export const composerInitialState: ComposerState = { expanded: false, value: "" };

export function composerReduce(state: ComposerState, event: ComposerEvent): ComposerState {
  switch (event.type) {
    case "expand":
      return state.expanded ? state : { ...state, expanded: true };
    case "change":
      return { ...state, value: event.value };
    case "collapse":
      return state.expanded ? { ...state, expanded: false } : state;
    case "submitted":
      return { expanded: false, value: "" };
  }
}

/** Submit is allowed only from the expanded state with a non-blank draft. */
export function composerCanSubmit(state: ComposerState): boolean {
  return state.expanded && state.value.trim().length > 0;
}
