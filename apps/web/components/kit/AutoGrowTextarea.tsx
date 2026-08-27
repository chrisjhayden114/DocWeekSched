import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ChangeEvent,
  type TextareaHTMLAttributes,
} from "react";

export type AutoGrowTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "rows"> & {
  /** Height floor in lines — what the empty field looks like. Replaces `rows`. */
  minRows?: number;
  /** Height ceiling in lines; past it the field scrolls instead of growing. */
  maxRows?: number;
};

/** useLayoutEffect warns during SSR; the first paint is client-side anyway. */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** jsdom returns "" for every computed length, so parseFloat gives NaN. */
function px(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * UX-3 #1 — the one multi-line field. Every place a user writes sentences uses
 * this instead of an `<input>` or a fixed-`rows` `<textarea>`: it grows with the
 * content AND keeps the native resize handle (`resize: vertical`), because
 * auto-grow guesses and the writer knows.
 *
 * Dragging that handle wins permanently: once the user has sized the box by
 * hand, auto-grow stops so the next keystroke cannot snap their box shut.
 */
export const AutoGrowTextarea = forwardRef<HTMLTextAreaElement, AutoGrowTextareaProps>(
  function AutoGrowTextarea(
    { minRows = 2, maxRows, className, onChange, ...rest },
    forwardedRef,
  ) {
    const ref = useRef<HTMLTextAreaElement | null>(null);
    useImperativeHandle(forwardedRef, () => ref.current as HTMLTextAreaElement);
    /** The height we last set; anything else means the user dragged the handle. */
    const autoHeight = useRef<number | null>(null);
    const userSized = useRef(false);

    const measure = useCallback(() => {
      const el = ref.current;
      if (!el || userSized.current) return;
      const cs = window.getComputedStyle(el);
      const lineHeight = px(cs.lineHeight) || px(cs.fontSize) * 1.4 || 20;
      const frame =
        px(cs.paddingTop) + px(cs.paddingBottom) + px(cs.borderTopWidth) + px(cs.borderBottomWidth);
      const border = px(cs.borderTopWidth) + px(cs.borderBottomWidth);
      // Collapse first: scrollHeight only shrinks back if the box is not already
      // holding it open.
      el.style.height = "auto";
      // scrollHeight covers content + padding; border-box height also wants border.
      const content = el.scrollHeight + border;
      const floor = lineHeight * minRows + frame;
      const ceiling = maxRows == null ? Number.POSITIVE_INFINITY : lineHeight * maxRows + frame;
      el.style.height = `${Math.min(Math.max(content, floor), ceiling)}px`;
      if (maxRows != null) el.style.overflowY = content > ceiling ? "auto" : "hidden";
      autoHeight.current = el.offsetHeight;
    }, [minRows, maxRows]);

    // Mount, controlled-value changes, and viewport width (fewer columns → more lines).
    useIsomorphicLayoutEffect(measure, [measure, rest.value, rest.defaultValue]);

    useEffect(() => {
      const onResize = () => measure();
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }, [measure]);

    // form.reset() clears the value without firing change (the community reply
    // form does this after a send), which would leave the box stretched.
    useEffect(() => {
      const form = ref.current?.form;
      if (!form) return;
      const onReset = () => window.setTimeout(measure, 0);
      form.addEventListener("reset", onReset);
      return () => form.removeEventListener("reset", onReset);
    }, [measure]);

    useEffect(() => {
      const el = ref.current;
      if (!el || typeof ResizeObserver === "undefined") return;
      let lastWidth: number | null = null;
      const observer = new ResizeObserver(() => {
        if (lastWidth !== el.offsetWidth) {
          // A narrower box wraps into more lines (a SlideOver opening, a
          // collapsing sidebar) — that is a re-measure, not a drag.
          lastWidth = el.offsetWidth;
          measure();
          return;
        }
        // measure() records the height it produced, including any clamping by
        // CSS min/max-height, so a mismatch here is the user's drag.
        if (autoHeight.current == null || userSized.current) return;
        if (Math.abs(el.offsetHeight - autoHeight.current) > 1) {
          userSized.current = true;
          el.style.overflowY = "";
        }
      });
      observer.observe(el);
      return () => observer.disconnect();
    }, [measure]);

    const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
      // Before onChange, so uncontrolled fields (name + defaultValue) grow too.
      measure();
      onChange?.(e);
    };

    return (
      <textarea
        {...rest}
        ref={ref}
        className={className ? `${className} textarea-autogrow` : "textarea textarea-autogrow"}
        onChange={handleChange}
      />
    );
  },
);
