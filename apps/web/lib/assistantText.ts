/**
 * Defensive plain-text cleanup for assistant chat bodies.
 *
 * Both chats render as plain text (no markdown). The model still emits
 * **bold** / *italic* anyway; strip those markers before the shared
 * splitByLinks path so literal asterisks never reach the bubble. Never run
 * this on user-typed messages.
 */

const CODE_SPAN = /`[^`]*`/g;

/** Placeholder so emphasis regexes cannot see inside inline code. */
function parkCodeSpans(text: string): { text: string; restore: (s: string) => string } {
  const parked: string[] = [];
  const parkedText = text.replace(CODE_SPAN, (span) => {
    parked.push(span);
    return `\u0000${parked.length - 1}\u0000`;
  });
  return {
    text: parkedText,
    restore: (s) => s.replace(/\u0000(\d+)\u0000/g, (_, i) => parked[Number(i)] ?? ""),
  };
}

/**
 * Remove markdown emphasis wrappers. Leaves code spans, snake_case,
 * multiplication (`2 * 3`), and bare asterisks alone.
 */
export function stripAssistantEmphasis(text: string): string {
  const { text: parked, restore } = parkCodeSpans(text);
  let out = parked;
  // **bold** then __bold__ (non-greedy, must wrap at least one character)
  out = out.replace(/\*\*([^*]+)\*\*/g, "$1");
  out = out.replace(/__([^_]+)__/g, "$1");
  // *word* or *words with spaces* — only when the asterisks wrap a token,
  // not when they sit in `2 * 3` or `a*b`.
  out = out.replace(/(^|[\s(])\*([A-Za-z0-9](?:[^*]*[A-Za-z0-9])?)\*(?=[\s).,!?:;]|$)/g, "$1$2");
  return restore(out);
}
