import { ReactNode, useRef } from "react";
import { nextPillIndex } from "./kitHelpers";

export type FilterPillOption = {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Optional count rendered after the label: "Questions · 12". */
  count?: number;
};

export type FilterPillsProps = {
  /** Accessible group name, e.g. "Filter posts". */
  label: string;
  options: FilterPillOption[];
  /** id of the active option. */
  value: string;
  onChange: (id: string) => void;
};

export { nextPillIndex };

/**
 * F1.2 #5 — the pill filter row: one active option, accent-filled,
 * icon-led. Radio-group semantics with the standard keyboard model —
 * arrows move selection and focus, Home/End jump to the ends — so the
 * whole row is one Tab stop.
 */
export function FilterPills({ label, options, value, onChange }: FilterPillsProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = Math.max(
    0,
    options.findIndex((o) => o.id === value),
  );

  const select = (index: number) => {
    if (index < 0 || index >= options.length) return;
    refs.current[index]?.focus();
    onChange(options[index].id);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        select(nextPillIndex(options.length, activeIndex, 1));
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        select(nextPillIndex(options.length, activeIndex, -1));
        break;
      case "Home":
        e.preventDefault();
        select(0);
        break;
      case "End":
        e.preventDefault();
        select(options.length - 1);
        break;
    }
  };

  return (
    <div className="kit-filter-pills" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((option, index) => {
        const active = index === activeIndex;
        return (
          <button
            key={option.id}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            className={active ? "kit-pill is-active" : "kit-pill"}
            onClick={() => onChange(option.id)}
          >
            {option.icon ? (
              <span className="kit-pill-icon" aria-hidden>
                {option.icon}
              </span>
            ) : null}
            {option.label}
            {typeof option.count === "number" ? <span className="kit-pill-count">{option.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
