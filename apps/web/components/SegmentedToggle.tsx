import type { CSSProperties, ReactNode } from "react";
import { useSegmentSlide } from "./useSegmentSlide";

/**
 * Shared segmented control with the E28.3 sliding active-segment background.
 * Markup and roles match the previous hand-rolled tablists exactly (div
 * role=tablist + button role=tab children); the only addition is the
 * `.seg-slide` indicator span managed by useSegmentSlide.
 */
export function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  className,
  ariaLabel,
  title,
  style,
}: {
  options: readonly { id: T; label: ReactNode }[];
  value: T;
  onChange: (next: T) => void;
  className: string;
  ariaLabel: string;
  title?: string;
  style?: CSSProperties;
}) {
  const ref = useSegmentSlide(value);
  return (
    <div ref={ref} className={className} role="tablist" aria-label={ariaLabel} title={title} style={style}>
      <span className="seg-slide" aria-hidden />
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          role="tab"
          aria-selected={value === opt.id}
          className={value === opt.id ? "active" : ""}
          onClick={() => onChange(opt.id)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
