import { SegmentedToggle } from "./SegmentedToggle";

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
    <SegmentedToggle
      className="schedule-view-switcher"
      ariaLabel="Schedule view"
      options={OPTIONS}
      value={value}
      onChange={onChange}
    />
  );
}
