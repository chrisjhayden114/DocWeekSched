/** @vitest-environment jsdom */
/**
 * AGENDA-2 — the filter rail: its ARIA contract, the sections that hide
 * themselves, and the collapsed state it remembers.
 *
 * The rail is rendered once and handed to both the desktop rail and the mobile
 * sheet, so every assertion here covers both surfaces at once. That sharing is
 * the point of the component and the thing a future edit is most likely to
 * break.
 */

import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  AgendaFilterRail,
  AgendaFiltersSheet,
  formatFilterOptions,
} from "../components/AgendaFilterPanel";
import { EMPTY_AGENDA_FILTERS, type AgendaFilters } from "../lib/agendaFilters";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let root: Root;
let container: HTMLDivElement;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(element: ReactElement) {
  act(() => root.render(element));
}

function click(target: EventTarget) {
  act(() => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

/** React tracks the value node, so a controlled input needs the native setter. */
function setInput(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(el, value);
  act(() => {
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const FORMAT_OPTIONS = formatFilterOptions(
  ["keynote", "workshop", "panel"],
  new Map([
    ["keynote", 1],
    ["workshop", 2],
    ["panel", 1],
  ]),
);

const TRACK_OPTIONS = [
  { id: "t-keynote", label: "Keynote", dot: "#0033A0", count: 2 },
  { id: "t-workshops", label: "Workshops", dot: "#0F6B4C", count: 2 },
];

const ROOM_OPTIONS = [
  { id: "r-hall", label: "Hall A", count: 3 },
  { id: "r-12", label: "Room 12", count: 1 },
];

const SPEAKER_OPTIONS = [
  { id: "maya", name: "Maya Chen", photoUrl: "/demo/speakers/maya-chen.svg", count: 2 },
  { id: "jonas", name: "Jonas Okonkwo", photoUrl: null, count: 2 },
];

/** A rail wired to a mutable filter object, so clicks can be observed. */
function Rail({
  filters = EMPTY_AGENDA_FILTERS,
  onChange = () => {},
  ...over
}: Partial<Parameters<typeof AgendaFilterRail>[0]> = {}) {
  return (
    <AgendaFilterRail
      filters={filters}
      onChange={onChange}
      days={["2026-06-08", "2026-06-09"]}
      formatOptions={FORMAT_OPTIONS}
      trackOptions={TRACK_OPTIONS}
      roomOptions={ROOM_OPTIONS}
      speakerOptions={SPEAKER_OPTIONS}
      storageScope="test"
      {...over}
    />
  );
}

function sections(): string[] {
  return [...container.querySelectorAll(".agenda-filter-section-head")].map(
    (el) => el.textContent?.trim() ?? "",
  );
}

function rows(): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[role="checkbox"]')];
}

function rowByLabel(label: string): HTMLElement {
  const found = rows().find((r) => r.textContent?.includes(label));
  if (!found) throw new Error(`No filter row labelled "${label}". Rows: ${rows().map((r) => r.textContent)}`);
  return found;
}

describe("AgendaFilterRail — section order and a11y", () => {
  it("renders the sections in reading order: format, track, room, speaker", () => {
    render(<Rail />);
    expect(sections()).toEqual([
      "Filter by format",
      "Filter by track",
      "Filter by room",
      "Speaker",
    ]);
  });

  it("gives every multi-select row role=checkbox with aria-checked", () => {
    // aria-checked, not aria-pressed: these rows combine, so a screen reader
    // announcing "pressed" would describe a radio group that does not exist.
    render(<Rail filters={{ ...EMPTY_AGENDA_FILTERS, formats: ["workshop"], roomIds: ["r-12"] }} />);
    for (const row of rows()) {
      expect(row.getAttribute("role")).toBe("checkbox");
      expect(row.getAttribute("aria-checked")).toMatch(/^(true|false)$/);
      expect(row.hasAttribute("aria-pressed")).toBe(false);
    }
    expect(rowByLabel("Workshop").getAttribute("aria-checked")).toBe("true");
    expect(rowByLabel("Keynote").getAttribute("aria-checked")).toBe("false");
    expect(rowByLabel("Room 12").getAttribute("aria-checked")).toBe("true");
    expect(rowByLabel("Hall A").getAttribute("aria-checked")).toBe("false");
  });

  it("gives the toggles the same checkbox contract as the rows", () => {
    render(<Rail showMySchedule filters={{ ...EMPTY_AGENDA_FILTERS, hasMaterials: true }} />);
    expect(rowByLabel("Has slides or materials").getAttribute("aria-checked")).toBe("true");
    expect(rowByLabel("My schedule only").getAttribute("aria-checked")).toBe("false");
  });

  it("labels each format row and draws a glyph for it", () => {
    render(<Rail />);
    // Only the formats the program actually uses get a row.
    expect(container.textContent).not.toContain("Lightning talk");
    expect(rowByLabel("Keynote").querySelector(".agenda-filter-glyph")).not.toBeNull();
    // The count comes from the caller's facet counts.
    expect(rowByLabel("Workshop").querySelector(".agenda-filter-count")!.textContent).toBe("2");
  });

  it("shows the track color dot, so the rows double as the legend", () => {
    render(<Rail />);
    const dot = rowByLabel("Workshops").querySelector<HTMLElement>(".agenda-filter-dot");
    expect(dot).not.toBeNull();
    expect(dot!.style.background).toBeTruthy();
  });

  it("orders format rows by the vocabulary, not by the order they were passed", () => {
    // Otherwise the section reshuffles between two events, or two days of one.
    const shuffled = formatFilterOptions(["panel", "keynote", "workshop"], new Map());
    expect(shuffled.map((o) => o.id)).toEqual(["keynote", "workshop", "panel"]);
  });
});

describe("AgendaFilterRail — toggling", () => {
  it("adds and removes a value in a multi-select group", () => {
    let filters: AgendaFilters = EMPTY_AGENDA_FILTERS;
    const onChange = (next: AgendaFilters) => {
      filters = next;
    };

    render(<Rail filters={filters} onChange={onChange} />);
    click(rowByLabel("Workshop"));
    expect(filters.formats).toEqual(["workshop"]);

    render(<Rail filters={filters} onChange={onChange} />);
    click(rowByLabel("Panel"));
    expect(filters.formats).toEqual(["workshop", "panel"]);

    render(<Rail filters={filters} onChange={onChange} />);
    click(rowByLabel("Workshop"));
    expect(filters.formats).toEqual(["panel"]);
  });

  it("flips a toggle without touching the other filters", () => {
    let filters: AgendaFilters = { ...EMPTY_AGENDA_FILTERS, formats: ["workshop"] };
    render(
      <Rail
        showMySchedule
        filters={filters}
        onChange={(next) => {
          filters = next;
        }}
      />,
    );
    click(rowByLabel("Has slides or materials"));
    expect(filters).toEqual({ ...EMPTY_AGENDA_FILTERS, formats: ["workshop"], hasMaterials: true });
  });
});

describe("AgendaFilterRail — hidden when there is nothing to filter on", () => {
  it("hides a section whose options are empty", () => {
    render(<Rail formatOptions={[]} />);
    expect(sections()).toEqual(["Filter by track", "Filter by room", "Speaker"]);
    expect(container.textContent).not.toContain("Filter by format");
  });

  it("hides the room section for a one-room event", () => {
    // The page passes [] when isGroupFilterable says the group cannot split the
    // program, so a one-room event never sees a room filter.
    render(<Rail roomOptions={[]} />);
    expect(sections()).not.toContain("Filter by room");
  });

  it("renders no sections at all for an event with nothing to filter on", () => {
    render(<Rail formatOptions={[]} trackOptions={[]} roomOptions={[]} speakerOptions={[]} />);
    expect(sections()).toEqual([]);
    // The search box and the materials toggle always survive: both are useful
    // on a single-track, single-room program.
    expect(container.querySelector('input[type="search"]')).not.toBeNull();
    expect(rowByLabel("Has slides or materials")).not.toBeNull();
  });

  it("hides the day chips for a single-day event", () => {
    render(<Rail days={["2026-06-08"]} />);
    expect(container.querySelector(".day-chips")).toBeNull();
    render(<Rail days={["2026-06-08", "2026-06-09"]} />);
    expect(container.querySelector(".day-chips")).not.toBeNull();
  });

  it("hides 'My schedule only' on the public page", () => {
    render(<Rail />);
    expect(container.textContent).not.toContain("My schedule only");
    render(<Rail showMySchedule />);
    expect(container.textContent).toContain("My schedule only");
  });
});

describe("AgendaFilterRail — collapsing sections", () => {
  function head(label: string): HTMLElement {
    const found = [...container.querySelectorAll<HTMLElement>(".agenda-filter-section-head")].find(
      (el) => el.textContent?.includes(label),
    );
    if (!found) throw new Error(`No section head "${label}"`);
    return found;
  }

  it("starts open, and says so with aria-expanded", () => {
    render(<Rail />);
    expect(head("Filter by format").getAttribute("aria-expanded")).toBe("true");
    const bodyId = head("Filter by format").getAttribute("aria-controls")!;
    expect(document.getElementById(bodyId)!.hidden).toBe(false);
  });

  it("collapses on click and hides its body", () => {
    render(<Rail />);
    click(head("Filter by room"));
    expect(head("Filter by room").getAttribute("aria-expanded")).toBe("false");
    const bodyId = head("Filter by room").getAttribute("aria-controls")!;
    expect(document.getElementById(bodyId)!.hidden).toBe(true);
    // Collapsing one section leaves the others alone.
    expect(head("Filter by format").getAttribute("aria-expanded")).toBe("true");
  });

  it("remembers collapsed sections across a remount", () => {
    // An attendee who does not care about rooms collapses it once, not once
    // per visit for the rest of the conference.
    render(<Rail />);
    click(head("Filter by room"));

    act(() => root.unmount());
    root = createRoot(container);
    render(<Rail />);
    expect(head("Filter by room").getAttribute("aria-expanded")).toBe("false");
    expect(head("Filter by format").getAttribute("aria-expanded")).toBe("true");
  });

  it("remembers the two agendas' sections separately", () => {
    render(<Rail storageScope="public" />);
    click(head("Filter by room"));

    act(() => root.unmount());
    root = createRoot(container);
    render(<Rail storageScope="app" />);
    expect(head("Filter by room").getAttribute("aria-expanded")).toBe("true");
  });

  it("survives a localStorage that throws or holds junk", () => {
    window.localStorage.setItem("agendaFilterSections:test", "not json");
    render(<Rail />);
    expect(head("Filter by format").getAttribute("aria-expanded")).toBe("true");
  });
});

describe("AgendaFilterRail — clear all", () => {
  it("appears only when something is active", () => {
    render(<Rail />);
    expect(container.textContent).not.toContain("Clear all");
    render(<Rail filters={{ ...EMPTY_AGENDA_FILTERS, formats: ["workshop"] }} />);
    expect(container.textContent).toContain("Clear all");
  });

  it("does not appear for a day on its own", () => {
    // Same rule as the active count: the day is a place, not a narrowing.
    render(<Rail filters={{ ...EMPTY_AGENDA_FILTERS, dayKey: "2026-06-09" }} />);
    expect(container.textContent).not.toContain("Clear all");
  });

  it("clears every filter but the day", () => {
    let filters: AgendaFilters = {
      ...EMPTY_AGENDA_FILTERS,
      dayKey: "2026-06-09",
      formats: ["workshop"],
      roomIds: ["r-12"],
      speakerId: "maya",
      hasMaterials: true,
      query: "reading",
    };
    render(
      <Rail
        filters={filters}
        onChange={(next) => {
          filters = next;
        }}
      />,
    );
    const clear = [...container.querySelectorAll("button")].find((b) => b.textContent === "Clear all")!;
    click(clear);
    expect(filters).toEqual({ ...EMPTY_AGENDA_FILTERS, dayKey: "2026-06-09" });
  });
});

describe("AgendaFilterRail — speaker picker", () => {
  it("shows the roster with avatars once opened, using initials when there is no photo", () => {
    render(<Rail />);
    const input = container.querySelector<HTMLInputElement>('[aria-label="Filter by speaker"]')!;
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-expanded")).toBe("false");

    act(() => input.focus());
    const options = [...container.querySelectorAll('[role="option"]')];
    expect(options.map((o) => o.querySelector(".agenda-filter-row-label")!.textContent)).toEqual([
      "Maya Chen",
      "Jonas Okonkwo",
    ]);
    expect(options[0]!.querySelector("img")!.getAttribute("src")).toBe("/demo/speakers/maya-chen.svg");
    // No photo on the second speaker, so the shared avatar falls back to initials.
    expect(options[1]!.querySelector(".agenda-speaker-avatar")!.textContent).toBe("JO");
  });

  it("shows the chosen speaker as a removable row rather than a search box", () => {
    let filters: AgendaFilters = { ...EMPTY_AGENDA_FILTERS, speakerId: "maya" };
    render(
      <Rail
        filters={filters}
        onChange={(next) => {
          filters = next;
        }}
      />,
    );
    expect(container.querySelector(".agenda-speaker-selected")!.textContent).toContain("Maya Chen");
    click(container.querySelector('[aria-label="Clear speaker filter Maya Chen"]')!);
    expect(filters.speakerId).toBeNull();
  });

  it("filters the roster as you type, and says so when nothing matches", () => {
    render(<Rail />);
    const input = container.querySelector<HTMLInputElement>('[aria-label="Filter by speaker"]')!;
    act(() => input.focus());

    setInput(input, "jon");
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(container.textContent).toContain("Jonas Okonkwo");

    setInput(input, "zzz");
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(container.textContent).toContain("No matching speaker");
  });
});

describe("the rail renders identically in the desktop rail and the mobile sheet", () => {
  it("puts the same rows in both, from one element", () => {
    // The whole reason AgendaFilterRail exists: two filter UIs to keep in sync
    // is what AGENDA-2 set out to remove.
    const controls = <Rail showMySchedule />;

    render(<div className="agenda-rail-panel">{controls}</div>);
    const inRail = rows().map((r) => [r.getAttribute("role"), r.textContent]);

    render(
      <AgendaFiltersSheet open onClose={() => {}}>
        {controls}
      </AgendaFiltersSheet>,
    );
    const inSheet = rows().map((r) => [r.getAttribute("role"), r.textContent]);

    expect(inSheet).toEqual(inRail);
    expect(inSheet.length).toBeGreaterThan(0);
  });
});
