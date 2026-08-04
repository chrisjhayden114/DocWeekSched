/**
 * Pure keyboard-navigation logic for the shared Select control
 * (components/Select.tsx). Kept free of React so it can be unit-tested.
 */

export type SelectNavOption = {
  label: string;
  disabled?: boolean;
};

/** Index of the first non-disabled option, or -1. */
export function firstEnabledIndex(options: SelectNavOption[]): number {
  for (let i = 0; i < options.length; i++) {
    if (!options[i].disabled) return i;
  }
  return -1;
}

/** Index of the last non-disabled option, or -1. */
export function lastEnabledIndex(options: SelectNavOption[]): number {
  for (let i = options.length - 1; i >= 0; i--) {
    if (!options[i].disabled) return i;
  }
  return -1;
}

/**
 * Move the active index by one step up (-1) or down (+1), skipping disabled
 * options and stopping at the ends (no wrap — matches native listbox arrows).
 * Returns `from` unchanged when there is nowhere to go.
 */
export function moveActiveIndex(
  options: SelectNavOption[],
  from: number,
  step: -1 | 1,
): number {
  let i = from + step;
  while (i >= 0 && i < options.length) {
    if (!options[i].disabled) return i;
    i += step;
  }
  return from;
}

/**
 * Type-ahead: find the option whose label starts with the typed buffer,
 * case-insensitively.
 *
 * - A buffer of one repeated character ("s", "ss", "sss"…) cycles through
 *   options starting with that character, beginning after the active option —
 *   the way native <select> does.
 * - Any other buffer matches from the active option onward (inclusive), then
 *   wraps, so extending the buffer keeps the current match while it still fits.
 *
 * Returns -1 when nothing matches.
 */
export function typeaheadIndex(
  options: SelectNavOption[],
  buffer: string,
  activeIndex: number,
): number {
  if (!buffer || options.length === 0) return -1;
  const lower = buffer.toLowerCase();
  const repeated = lower.length > 1 && lower.split("").every((c) => c === lower[0]);
  const needle = repeated ? lower[0] : lower;
  const start = repeated || activeIndex < 0 ? activeIndex + 1 : activeIndex;

  for (let offset = 0; offset < options.length; offset++) {
    const i = (start + offset + options.length) % options.length;
    const opt = options[i];
    if (opt.disabled) continue;
    if (opt.label.toLowerCase().startsWith(needle)) return i;
  }
  return -1;
}

/** True when a keydown should feed the type-ahead buffer. */
export function isTypeaheadKey(key: string, ctrlKey: boolean, metaKey: boolean): boolean {
  return key.length === 1 && key !== " " && !ctrlKey && !metaKey;
}
