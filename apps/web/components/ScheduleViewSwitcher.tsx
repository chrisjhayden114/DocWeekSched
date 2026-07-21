export type ScheduleViewMode = "list" | "grid" | "room";

const OPTIONS: { id: ScheduleViewMode; label: string }[] = [
  { id: "list", label: "List" },
  { id: "grid", label: "Grid" },
  { id: "room", label: "By room" },
];

/** ≥768px only — CSS hides this below the breakpoint. */
export function ScheduleViewSwitcher({
  value,
  onChange,
}: {
  value: ScheduleViewMode;
  onChange: (mode: ScheduleViewMode) => void;
}) {
  return (
    <div className="schedule-view-switcher" role="tablist" aria-label="Schedule view">
      {OPTIONS.map((opt) => (
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
