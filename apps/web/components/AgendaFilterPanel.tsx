import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { SESSION_FORMATS, SESSION_FORMAT_LABELS, type SessionFormat } from "@event-app/shared";
import type { PeekSpeaker } from "../lib/sessionPeek";
import { CardAvatar } from "./SessionCardBits";
import {
  clearAgendaFilters,
  hasActiveFilters,
  toggleFilterValue,
  type AgendaFilters,
} from "../lib/agendaFilters";

/**
 * Agenda filter chrome (DESIGN_PHASE_D.md Part 2 "The agenda").
 * Day chips + quiet filter rows with 10px track color dots that double as the
 * legend. Purely presentational — wire to lib/agendaFilters state in the page.
 * These replace the naked native <select> dropdowns on agenda surfaces.
 *
 * AGENDA-2 turns the rail into the Sched-style stack of collapsible sections
 * that `AgendaFilterRail` composes. Two things are worth knowing before
 * editing it:
 *
 *   The rail is rendered once per page and handed to both the desktop rail and
 *   the mobile sheet as children. That is why nothing here reads a breakpoint —
 *   a section that behaved differently in the sheet would be a second filter UI
 *   to keep in sync, which is exactly what AGENDA-2 set out to remove.
 *
 *   Sections hide themselves when there is nothing to filter on. The decision
 *   is made from the *unfiltered* program in lib/agendaFilters
 *   (`isGroupFilterable`), so a rail does not reflow as you use it.
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

/* ------------------------------------------------------------------ *
 * AGENDA-2 — collapsible sections
 * ------------------------------------------------------------------ */

/**
 * Which sections a reader has collapsed, remembered per page.
 *
 * An attendee who does not care about rooms collapses that section once and
 * should not have to do it again on every visit for the rest of the
 * conference. Stored as one small JSON blob under a namespaced key, matching
 * the `namespace:scope` convention used elsewhere in the app.
 */
const SECTION_STORAGE_PREFIX = "agendaFilterSections";

type SectionState = Record<string, boolean>;

function readSectionState(scope: string): SectionState {
  try {
    const raw = window.localStorage.getItem(`${SECTION_STORAGE_PREFIX}:${scope}`);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as SectionState) : {};
  } catch {
    // A private-mode or quota-blocked localStorage must not take the rail down.
    return {};
  }
}

function writeSectionState(scope: string, state: SectionState): void {
  try {
    window.localStorage.setItem(`${SECTION_STORAGE_PREFIX}:${scope}`, JSON.stringify(state));
  } catch {
    /* Collapsed state is a convenience; losing it is not worth an error. */
  }
}

/**
 * Remembered open/closed state for the rail's sections.
 *
 * Read in an effect rather than during render: the public agenda is
 * server-rendered, and reading localStorage while rendering would make the
 * server and client markup disagree. Everything starts open, which is also
 * what a first-time visitor gets.
 */
function useSectionState(scope: string) {
  const [collapsed, setCollapsed] = useState<SectionState>({});

  useEffect(() => {
    setCollapsed(readSectionState(scope));
  }, [scope]);

  const toggle = useCallback(
    (id: string) => {
      setCollapsed((prev) => {
        const next = { ...prev, [id]: !prev[id] };
        writeSectionState(scope, next);
        return next;
      });
    },
    [scope],
  );

  return { collapsed, toggle };
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`agenda-filter-chevron${open ? " is-open" : ""}`}
      viewBox="0 0 16 16"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

export function FilterSection({
  id,
  label,
  open,
  onToggle,
  children,
}: {
  id: string;
  label: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const bodyId = `agenda-filter-body-${id}`;
  return (
    <div className="agenda-filter-group">
      <button
        type="button"
        className="agenda-filter-section-head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        <span className="agenda-filter-group-label">{label}</span>
        <Chevron open={open} />
      </button>
      <div id={bodyId} hidden={!open}>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * AGENDA-2 — format glyphs
 * ------------------------------------------------------------------ */

/**
 * One glyph per format, so the format rows are scannable without reading.
 *
 * Line art rather than emoji: emoji render at a different weight on every
 * platform and carry a skin tone and a mood nobody chose. Each path is drawn
 * in a 24×24 box to match the other icons in the app.
 */
const FORMAT_GLYPH_PATHS: Record<SessionFormat, string> = {
  // A microphone on a stand.
  keynote: "M12 3a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-5 0v-4A2.5 2.5 0 0 1 12 3zM6.5 10.5a5.5 5.5 0 0 0 11 0M12 16v5M9 21h6",
  // A speech bubble.
  talk: "M4 5h16v10H9l-5 4V5z",
  // Hands-on: a wrench.
  workshop: "M14.5 3a4.5 4.5 0 0 0-4 6.6L3 17v4h4l7.4-7.5A4.5 4.5 0 1 0 14.5 3z",
  // Three seats in a row.
  panel: "M4 20v-3a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v3M7 10a2 2 0 1 0 0-.1M12 10a2 2 0 1 0 0-.1M17 10a2 2 0 1 0 0-.1",
  // A bolt.
  lightning: "M13 3L5 14h6l-1 7 8-11h-6l1-7z",
  // A board on legs.
  poster: "M4 4h16v11H4zM9 19l3-4 3 4",
  // A cup with a handle.
  break: "M4 8h12v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8zM16 9h2a2 2 0 0 1 0 5h-2M5 21h12",
  // Two people.
  social: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M16 5.2a3 3 0 0 1 0 5.6M17 14.2a4 4 0 0 1 4 3.8v2",
  // A plain marker for "none of the above".
  other: "M12 5.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z",
};

/**
 * Format rows for the rail, always in vocabulary order rather than in whatever
 * order the program happens to list them, so the section does not reshuffle
 * between two events — or between two days of the same one.
 */
export function formatFilterOptions(
  keys: readonly string[],
  counts: Map<string, number>,
): FilterOption[] {
  return SESSION_FORMATS.filter((f) => keys.includes(f)).map((f) => ({
    id: f,
    label: SESSION_FORMAT_LABELS[f],
    count: counts.get(f) ?? 0,
  }));
}

export function FormatGlyph({ format }: { format: string }) {
  const path = FORMAT_GLYPH_PATHS[format as SessionFormat];
  if (!path) return null;
  return (
    <svg
      className="agenda-filter-glyph"
      viewBox="0 0 24 24"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * AGENDA-2 — multi-select rows and toggles
 * ------------------------------------------------------------------ */

/**
 * Checkbox rows for a multi-select group.
 *
 * `role="checkbox"` with `aria-checked` rather than the single-select
 * `aria-pressed` of `FilterGroup`: these rows combine, and a screen reader
 * announcing "pressed" would describe a radio group that does not exist here.
 */
export function MultiSelectFilter({
  options,
  values,
  onToggle,
  renderGlyph,
}: {
  options: FilterOption[];
  values: readonly string[];
  onToggle: (id: string) => void;
  renderGlyph?: (id: string) => ReactNode;
}) {
  return (
    <>
      {options.map((opt) => {
        const checked = values.includes(opt.id);
        return (
          <button
            key={opt.id}
            type="button"
            role="checkbox"
            aria-checked={checked}
            className={`agenda-filter-row${checked ? " is-active" : ""}`}
            onClick={() => onToggle(opt.id)}
          >
            <span className="agenda-filter-check" aria-hidden>
              {checked ? (
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3.5 8.5l3 3 6-7" />
                </svg>
              ) : null}
            </span>
            {renderGlyph ? renderGlyph(opt.id) : null}
            {opt.dot ? <span className="agenda-filter-dot" style={{ background: opt.dot }} aria-hidden /> : null}
            <span className="agenda-filter-row-label">{opt.label}</span>
            {opt.count != null ? <span className="agenda-filter-count">{opt.count}</span> : null}
          </button>
        );
      })}
    </>
  );
}

/** A single on/off filter ("Has slides or materials"). */
export function ToggleFilterRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      className={`agenda-filter-row${checked ? " is-active" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="agenda-filter-check" aria-hidden>
        {checked ? (
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3.5 8.5l3 3 6-7" />
          </svg>
        ) : null}
      </span>
      <span className="agenda-filter-row-label">{label}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * AGENDA-2 — speaker picker
 * ------------------------------------------------------------------ */

export type SpeakerFilterOption = PeekSpeaker & { id: string; count?: number };

/**
 * Searchable single-select over the speaker roster, with the same avatars the
 * cards and the peek use.
 *
 * Searchable rather than a list of rows because a roster is the one filter
 * group with no useful ceiling — a 300-speaker conference would otherwise put
 * 300 rows in the rail — and single-select because "sessions by these four
 * people" is a schedule, not a filter: that is what My schedule is for.
 */
export function SpeakerFilter({
  options,
  value,
  onChange,
}: {
  options: readonly SpeakerFilterOption[];
  value: string | null;
  onChange: (speakerId: string | null) => void;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => options.find((o) => o.id === value) ?? null, [options, value]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 50);
    return options.filter((o) => o.name.toLowerCase().includes(q)).slice(0, 50);
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (selected && !open) {
    return (
      <div className="agenda-speaker-selected">
        <SpeakerAvatar person={selected} />
        <span className="agenda-filter-row-label">{selected.name}</span>
        <button
          type="button"
          className="agenda-speaker-clear"
          aria-label={`Clear speaker filter ${selected.name}`}
          onClick={() => onChange(null)}
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="agenda-speaker-picker">
      <input
        className="input"
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label="Filter by speaker"
        autoComplete="off"
        placeholder="Search speakers…"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            setQuery("");
          }
        }}
      />
      {open ? (
        <ul id={listId} className="agenda-speaker-list" role="listbox">
          {matches.length === 0 ? (
            <li className="help-text agenda-speaker-empty">No matching speaker</li>
          ) : (
            matches.map((person) => (
              <li key={person.id} role="option" aria-selected={person.id === value}>
                <button
                  type="button"
                  className="agenda-speaker-option"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange(person.id);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <SpeakerAvatar person={person} />
                  <span className="agenda-filter-row-label">{person.name}</span>
                  {person.count != null ? (
                    <span className="agenda-filter-count">{person.count}</span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

/** The card's own face, at rail size — see CardAvatar in SessionCardBits. */
function SpeakerAvatar({ person }: { person: PeekSpeaker }) {
  return <CardAvatar person={person} className="agenda-speaker-avatar" />;
}

/* ------------------------------------------------------------------ *
 * AGENDA-2 — the composed rail
 * ------------------------------------------------------------------ */

export type AgendaFilterRailProps = {
  filters: AgendaFilters;
  onChange: (next: AgendaFilters) => void;
  /** Day keys, in order. Fewer than two hides the day chips. */
  days: string[];
  /** Empty hides the section — see isGroupFilterable in lib/agendaFilters. */
  formatOptions: FilterOption[];
  trackOptions: FilterOption[];
  roomOptions: FilterOption[];
  speakerOptions: SpeakerFilterOption[];
  /** In-app only: the public page has no schedule to filter down to. */
  showMySchedule?: boolean;
  /** localStorage scope, so the two agendas remember their sections apart. */
  storageScope: string;
  /** Page-owned controls rendered above the sections (the timezone toggle). */
  children?: ReactNode;
};

/**
 * The whole filter rail, rendered once per page and handed to both the desktop
 * rail and the mobile sheet.
 *
 * Section order is deliberate and matches how people narrow a program: when,
 * then what kind of thing, then which strand, then where, then who, then the
 * two "only show me…" switches.
 */
export function AgendaFilterRail({
  filters,
  onChange,
  days,
  formatOptions,
  trackOptions,
  roomOptions,
  speakerOptions,
  showMySchedule,
  storageScope,
  children,
}: AgendaFilterRailProps) {
  const { collapsed, toggle } = useSectionState(storageScope);
  const section = (id: string) => ({
    id,
    open: !collapsed[id],
    onToggle: () => toggle(id),
  });

  return (
    <>
      <input
        className="input"
        type="search"
        placeholder="Search sessions, speakers, papers, presentations…"
        aria-label="Search sessions"
        value={filters.query}
        onChange={(e) => onChange({ ...filters, query: e.target.value })}
      />

      {children}

      {days.length > 1 ? (
        <DayChips
          days={days}
          value={filters.dayKey ?? ""}
          onChange={(dayKey) => onChange({ ...filters, dayKey: dayKey || null })}
        />
      ) : null}

      {formatOptions.length > 0 ? (
        <FilterSection {...section("format")} label="Filter by format">
          <MultiSelectFilter
            options={formatOptions}
            values={filters.formats}
            onToggle={(id) => onChange({ ...filters, formats: toggleFilterValue(filters.formats, id) })}
            renderGlyph={(id) => <FormatGlyph format={id} />}
          />
        </FilterSection>
      ) : null}

      {trackOptions.length > 0 ? (
        <FilterSection {...section("track")} label="Filter by track">
          <MultiSelectFilter
            options={trackOptions}
            values={filters.trackIds}
            onToggle={(id) => onChange({ ...filters, trackIds: toggleFilterValue(filters.trackIds, id) })}
          />
        </FilterSection>
      ) : null}

      {roomOptions.length > 0 ? (
        <FilterSection {...section("room")} label="Filter by room">
          <MultiSelectFilter
            options={roomOptions}
            values={filters.roomIds}
            onToggle={(id) => onChange({ ...filters, roomIds: toggleFilterValue(filters.roomIds, id) })}
          />
        </FilterSection>
      ) : null}

      {speakerOptions.length > 0 ? (
        <FilterSection {...section("speaker")} label="Speaker">
          <SpeakerFilter
            options={speakerOptions}
            value={filters.speakerId}
            onChange={(speakerId) => onChange({ ...filters, speakerId })}
          />
        </FilterSection>
      ) : null}

      <div className="agenda-filter-group">
        <ToggleFilterRow
          label="Has slides or materials"
          checked={filters.hasMaterials}
          onChange={(hasMaterials) => onChange({ ...filters, hasMaterials })}
        />
        {showMySchedule ? (
          <ToggleFilterRow
            label="My schedule only"
            checked={filters.mySchedule}
            onChange={(mySchedule) => onChange({ ...filters, mySchedule })}
          />
        ) : null}
      </div>

      {hasActiveFilters(filters) ? (
        <button
          type="button"
          className="button ghost agenda-filter-clear"
          onClick={() => onChange(clearAgendaFilters(filters))}
        >
          Clear all
        </button>
      ) : null}
    </>
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
