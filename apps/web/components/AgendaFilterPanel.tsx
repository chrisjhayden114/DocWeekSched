import type { ReactNode } from "react";

/**
 * Agenda filter chrome (DESIGN_PHASE_D.md Part 2 "The agenda").
 * Day chips + quiet filter rows with 10px track color dots that double as the
 * legend. Purely presentational — wire to lib/agendaFilters state in the page.
 * These replace the naked native <select> dropdowns on agenda surfaces.
 */

export type FilterOption = {
  id: string;
  label: string;
  /** 10px legend dot color (tracks). */
  dot?: string;
  count?: number;
};

/** "2026-07-20" → parts for the mobile date strip (timezone-safe). */
export function dayChipParts(dayKey: string): { weekday: string; dayNum: string; full: string } {
  const [y, m, d] = dayKey.split("-").map((n) => Number(n));
  if (!y || !m || !d) return { weekday: dayKey, dayNum: "", full: dayKey };
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(date);
  const dayNum = new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: "UTC" }).format(date);
  const monthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
  return { weekday, dayNum, full: `${weekday}, ${monthDay}` };
}

/** "2026-07-20" → short chip label like "Mon, Jul 20" (timezone-safe). */
export function dayChipLabel(dayKey: string): string {
  return dayChipParts(dayKey).full;
}

export function DayChips({
  days,
  value,
  onChange,
  allLabel = "All days",
}: {
  days: string[];
  value: string;
  onChange: (dayKey: string) => void;
  allLabel?: string;
}) {
  if (days.length < 2) return null;
  return (
    <div className="day-chips" role="tablist" aria-label="Days">
      <button
        type="button"
        role="tab"
        aria-selected={value === ""}
        className={`day-chip day-chip--all${value === "" ? " is-active" : ""}`}
        onClick={() => onChange("")}
      >
        <span className="day-chip-full">{allLabel}</span>
      </button>
      {days.map((day) => {
        const parts = dayChipParts(day);
        return (
          <button
            key={day}
            type="button"
            role="tab"
            aria-selected={value === day}
            className={`day-chip${value === day ? " is-active" : ""}`}
            onClick={() => onChange(day)}
            aria-label={parts.full}
          >
            <span className="day-chip-weekday">{parts.weekday}</span>
            <span className="day-chip-num">{parts.dayNum}</span>
            <span className="day-chip-full">{parts.full}</span>
          </button>
        );
      })}
    </div>
  );
}

export function FilterGroup({
  label,
  options,
  value,
  onChange,
  allLabel = "All",
}: {
  label: string;
  options: FilterOption[];
  value: string;
  onChange: (id: string) => void;
  allLabel?: string;
}) {
  if (options.length === 0) return null;
  return (
    <div className="agenda-filter-group">
      <span className="agenda-filter-group-label">{label}</span>
      <button
        type="button"
        className={`agenda-filter-row${value === "" ? " is-active" : ""}`}
        aria-pressed={value === ""}
        onClick={() => onChange("")}
      >
        <span className="agenda-filter-row-label">{allLabel}</span>
      </button>
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          className={`agenda-filter-row${value === opt.id ? " is-active" : ""}`}
          aria-pressed={value === opt.id}
          onClick={() => onChange(value === opt.id ? "" : opt.id)}
        >
          {opt.dot ? <span className="agenda-filter-dot" style={{ background: opt.dot }} aria-hidden /> : null}
          <span className="agenda-filter-row-label">{opt.label}</span>
          {opt.count != null ? <span className="agenda-filter-count">{opt.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Mobile/tablet filters sheet (<1280px); the same children render in the desktop rail. */
export function AgendaFiltersSheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="shell-sheet-backdrop" role="presentation" onClick={onClose}>
      <div
        className="shell-sheet agenda-filters-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Filters"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="agenda-filters-sheet-head">
          <span className="text-h3">Filters</span>
          <button type="button" className="button ghost" onClick={onClose}>
            Done
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
