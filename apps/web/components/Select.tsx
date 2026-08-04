import {
  CSSProperties,
  KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  firstEnabledIndex,
  isTypeaheadKey,
  lastEnabledIndex,
  moveActiveIndex,
  typeaheadIndex,
} from "../lib/selectControl";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type Props = {
  options: SelectOption[];
  /** Controlled value. Leave undefined for uncontrolled use with defaultValue. */
  value?: string;
  /** Uncontrolled initial value (mirrors native <select defaultValue>). */
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Shown on the trigger when the current value matches no option. */
  placeholder?: string;
  disabled?: boolean;
  /**
   * Participates in native form validation like a required <select>: while the
   * value is empty an invisible required input blocks form submission and the
   * browser shows its usual message.
   */
  required?: boolean;
  /** Submitted with the surrounding form via a hidden input, like a native select. */
  name?: string;
  /** Applied to the trigger button so <label htmlFor> keeps working. */
  id?: string;
  "aria-label"?: string;
  /** Extra class on the root, e.g. "select-compact". */
  className?: string;
  /** Root style — use for layout constraints like maxWidth. */
  style?: CSSProperties;
};

const TYPEAHEAD_RESET_MS = 500;

/**
 * The one Select control (chunk E17): a styled, accessible replacement for
 * native single-value <select>. ARIA 1.2 select-only combobox — focus stays on
 * the trigger; the active option is conveyed via aria-activedescendant.
 * Keyboard: arrows, Home/End, type-ahead, Enter/Space commit, Esc closes,
 * Tab commits and moves on.
 */
export function Select({
  options,
  value,
  defaultValue,
  onChange,
  placeholder,
  disabled,
  required,
  name,
  id,
  "aria-label": ariaLabel,
  className,
  style,
}: Props) {
  const listboxId = useId();
  const controlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");
  const currentValue = controlled ? value : internalValue;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const bufferRef = useRef("");
  const bufferTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedIndex = useMemo(
    () => options.findIndex((o) => o.value === currentValue),
    [options, currentValue],
  );
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (!open || activeIndex < 0 || !listRef.current) return;
    const el = listRef.current.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  useEffect(
    () => () => {
      if (bufferTimerRef.current) clearTimeout(bufferTimerRef.current);
    },
    [],
  );

  function optionId(index: number) {
    return `${listboxId}-opt-${index}`;
  }

  function openList(startIndex?: number) {
    const fallback = selectedIndex >= 0 ? selectedIndex : firstEnabledIndex(options);
    setActiveIndex(startIndex ?? fallback);
    setOpen(true);
  }

  function closeList() {
    setOpen(false);
    bufferRef.current = "";
  }

  function commit(index: number) {
    const opt = options[index];
    if (!opt || opt.disabled) return;
    if (!controlled) setInternalValue(opt.value);
    onChange?.(opt.value);
    closeList();
  }

  function feedTypeahead(char: string) {
    bufferRef.current += char;
    if (bufferTimerRef.current) clearTimeout(bufferTimerRef.current);
    bufferTimerRef.current = setTimeout(() => {
      bufferRef.current = "";
    }, TYPEAHEAD_RESET_MS);
    const anchor = open ? activeIndex : selectedIndex;
    const match = typeaheadIndex(options, bufferRef.current, anchor);
    if (match >= 0) {
      if (!open) openList(match);
      else setActiveIndex(match);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openList();
      } else if (e.key === "Home") {
        e.preventDefault();
        openList(firstEnabledIndex(options));
      } else if (e.key === "End") {
        e.preventDefault();
        openList(lastEnabledIndex(options));
      } else if (isTypeaheadKey(e.key, e.ctrlKey, e.metaKey)) {
        feedTypeahead(e.key);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => moveActiveIndex(options, i, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => moveActiveIndex(options, i, -1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(firstEnabledIndex(options));
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(lastEnabledIndex(options));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (activeIndex >= 0) commit(activeIndex);
      else closeList();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeList();
    } else if (e.key === "Tab") {
      // APG select-only combobox: Tab commits the active option, then moves on.
      if (activeIndex >= 0) commit(activeIndex);
      else closeList();
    } else if (isTypeaheadKey(e.key, e.ctrlKey, e.metaKey)) {
      feedTypeahead(e.key);
    }
  }

  return (
    <div ref={rootRef} className={`select-control${className ? ` ${className}` : ""}`} style={style}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        className="select-trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        aria-label={ariaLabel}
        aria-required={required || undefined}
        disabled={disabled}
        onClick={() => (open ? closeList() : openList())}
        onKeyDown={onKeyDown}
      >
        <span className={`select-value${selectedOption ? "" : " is-placeholder"}`}>
          {selectedOption ? selectedOption.label : placeholder || "Select…"}
        </span>
        <span className="select-caret" aria-hidden />
      </button>
      {name ? <input type="hidden" name={name} value={currentValue} /> : null}
      {required && !disabled && !currentValue ? (
        // Invisible input that carries the `required` constraint so the
        // surrounding form blocks submission exactly like a native select.
        // When the browser focuses it to report the error, focus is forwarded
        // to the trigger so the message anchors somewhere visible.
        <input
          className="select-required-sentinel"
          tabIndex={-1}
          aria-hidden="true"
          required
          value=""
          onChange={() => undefined}
          onFocus={() => triggerRef.current?.focus()}
        />
      ) : null}
      {open ? (
        <div id={listboxId} ref={listRef} role="listbox" className="select-popup">
          {options.length === 0 ? (
            <div className="select-option" aria-disabled="true">
              No options
            </div>
          ) : (
            options.map((opt, i) => (
              <div
                key={`${opt.value}-${i}`}
                id={optionId(i)}
                role="option"
                aria-selected={i === selectedIndex}
                aria-disabled={opt.disabled || undefined}
                className={`select-option${i === activeIndex ? " is-active" : ""}${
                  i === selectedIndex ? " is-selected" : ""
                }`}
                onMouseDown={(e) => {
                  // Keep focus on the trigger; commit on the same gesture.
                  e.preventDefault();
                  if (!opt.disabled) commit(i);
                }}
                onMouseEnter={() => {
                  if (!opt.disabled) setActiveIndex(i);
                }}
              >
                <span className="select-option-label">{opt.label}</span>
                {i === selectedIndex ? (
                  <span className="select-option-check" aria-hidden>
                    ✓
                  </span>
                ) : null}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
