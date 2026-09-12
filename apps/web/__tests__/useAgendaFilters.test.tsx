/** @vitest-environment jsdom */
/**
 * AGENDA-2 — filters in the URL.
 *
 * What this pins down is the interaction between three things that are easy to
 * get into a fight: component state, `router.replace` with `shallow`, and the
 * effect that reads the query back. The failure modes are specific — a rewrite
 * on first paint, a reader's click being reverted a tick later by the stale
 * URL, or a back button that moves the address bar but not the rail — so each
 * gets a test.
 */

import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedUrlQuery } from "querystring";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

/** A router stand-in that behaves like `shallow` replace: query updates, no remount. */
const routerState: {
  query: ParsedUrlQuery;
  pathname: string;
  isReady: boolean;
  replace: ReturnType<typeof vi.fn>;
} = {
  query: {},
  pathname: "/e/[slug]",
  isReady: true,
  replace: vi.fn(),
};

vi.mock("next/router", () => ({
  useRouter: () => routerState,
}));

const { useAgendaFilters } = await import("../components/useAgendaFilters");
const { EMPTY_AGENDA_FILTERS } = await import("../lib/agendaFilters");

let root: Root;
let container: HTMLDivElement;
/** Latest hook output, so assertions can read it without a render tree. */
let latest: ReturnType<typeof useAgendaFilters>;

function Probe() {
  latest = useAgendaFilters();
  return <output>{JSON.stringify(latest.filters)}</output>;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  routerState.query = { slug: "demo" };
  routerState.pathname = "/e/[slug]";
  routerState.isReady = true;
  routerState.replace = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(element: ReactElement = <Probe />) {
  act(() => root.render(element));
}

/** Re-render after mutating routerState.query, as a shallow replace would. */
function rerender() {
  act(() => root.render(<Probe />));
}

describe("useAgendaFilters — reading the URL", () => {
  it("starts unfiltered when the query has no filters", () => {
    render();
    expect(latest.filters).toEqual(EMPTY_AGENDA_FILTERS);
    expect(latest.ready).toBe(true);
  });

  it("hydrates every filter from the query", () => {
    routerState.query = {
      slug: "demo",
      day: "2026-06-08",
      format: "workshop,panel",
      track: "t-1",
      room: "r-1,r-2",
      speaker: "maya",
      materials: "1",
      mine: "1",
      q: "reading",
    };
    render();
    expect(latest.filters).toEqual({
      dayKey: "2026-06-08",
      formats: ["workshop", "panel"],
      trackIds: ["t-1"],
      roomIds: ["r-1", "r-2"],
      speakerId: "maya",
      hasMaterials: true,
      mySchedule: true,
      query: "reading",
    });
  });

  it("does not touch the URL on mount", () => {
    // A sync-on-render effect would rewrite the URL on first paint, churning
    // history and fighting the read above.
    routerState.query = { slug: "demo", format: "workshop" };
    render();
    expect(routerState.replace).not.toHaveBeenCalled();
  });

  it("waits for the router before reporting ready", () => {
    routerState.isReady = false;
    routerState.query = { slug: "demo", format: "workshop" };
    render();
    expect(latest.ready).toBe(false);
    expect(latest.filters).toEqual(EMPTY_AGENDA_FILTERS);

    routerState.isReady = true;
    rerender();
    expect(latest.ready).toBe(true);
    expect(latest.filters.formats).toEqual(["workshop"]);
  });
});

describe("useAgendaFilters — writing the URL", () => {
  it("replaces shallowly, preserving the page's own query keys", () => {
    render();
    act(() => latest.setFilters({ ...EMPTY_AGENDA_FILTERS, formats: ["workshop"] }));

    expect(routerState.replace).toHaveBeenCalledTimes(1);
    expect(routerState.replace).toHaveBeenCalledWith(
      // `slug` is the page's, not ours, and has to survive.
      { pathname: "/e/[slug]", query: { slug: "demo", format: "workshop" } },
      undefined,
      { shallow: true },
    );
  });

  it("preserves the dashboard's tab", () => {
    routerState.pathname = "/dashboard";
    routerState.query = { tab: "Agenda" };
    render();
    act(() => latest.setFilters({ ...EMPTY_AGENDA_FILTERS, roomIds: ["r-1"] }));
    expect(routerState.replace).toHaveBeenCalledWith(
      { pathname: "/dashboard", query: { tab: "Agenda", room: "r-1" } },
      undefined,
      { shallow: true },
    );
  });

  it("drops a filter key from the URL when it is cleared", () => {
    routerState.query = { slug: "demo", format: "workshop", q: "reading" };
    render();
    act(() => latest.setFilters({ ...EMPTY_AGENDA_FILTERS, formats: ["workshop"] }));
    expect(routerState.replace).toHaveBeenCalledWith(
      { pathname: "/e/[slug]", query: { slug: "demo", format: "workshop" } },
      undefined,
      { shallow: true },
    );
  });

  it("keeps the reader's change when the stale query arrives a tick later", () => {
    // The regression this guards: state updates synchronously while
    // router.query catches up, so a naive effect sees new state beside the old
    // URL and reverts the click that was just made.
    render();
    act(() => latest.setFilters({ ...EMPTY_AGENDA_FILTERS, formats: ["workshop"] }));
    expect(latest.filters.formats).toEqual(["workshop"]);

    rerender();
    expect(latest.filters.formats).toEqual(["workshop"]);

    // Now the shallow replace lands.
    routerState.query = { slug: "demo", format: "workshop" };
    rerender();
    expect(latest.filters.formats).toEqual(["workshop"]);
  });
});

describe("useAgendaFilters — pages without a my-schedule", () => {
  function PublicProbe() {
    latest = useAgendaFilters({ mySchedule: false });
    return null;
  }

  it("ignores ?mine=1 so the Filters badge stays honest", () => {
    // Only reachable by pasting an in-app link into a public URL: the filter
    // has no set of joined sessions to narrow to, so counting it would claim
    // an agenda was filtered when it was not.
    routerState.query = { slug: "demo", mine: "1", format: "workshop" };
    render(<PublicProbe />);
    expect(latest.filters.mySchedule).toBe(false);
    expect(latest.filters.formats).toEqual(["workshop"]);
  });

  it("never writes mine=1 to the URL", () => {
    render(<PublicProbe />);
    act(() => latest.setFilters({ ...EMPTY_AGENDA_FILTERS, mySchedule: true, roomIds: ["r-1"] }));
    expect(latest.filters.mySchedule).toBe(false);
    expect(routerState.replace).toHaveBeenCalledWith(
      { pathname: "/e/[slug]", query: { slug: "demo", room: "r-1" } },
      undefined,
      { shallow: true },
    );
  });

  it("keeps it on pages that do have one", () => {
    routerState.query = { tab: "Agenda", mine: "1" };
    render();
    expect(latest.filters.mySchedule).toBe(true);
  });
});

describe("useAgendaFilters — back and forward", () => {
  it("follows the URL when it changes underneath the page", () => {
    render();
    act(() => latest.setFilters({ ...EMPTY_AGENDA_FILTERS, formats: ["workshop"] }));
    expect(latest.filters.formats).toEqual(["workshop"]);
    routerState.query = { slug: "demo", format: "workshop" };
    rerender();

    // A shallow replace does not remount, so only this can keep the rail and
    // the address bar together.
    routerState.query = { slug: "demo" };
    rerender();
    expect(latest.filters).toEqual(EMPTY_AGENDA_FILTERS);

    routerState.query = { slug: "demo", room: "r-1", q: "math" };
    rerender();
    expect(latest.filters.roomIds).toEqual(["r-1"]);
    expect(latest.filters.query).toBe("math");
    expect(latest.filters.formats).toEqual([]);
  });

  it("ignores a query change that means the same thing", () => {
    routerState.query = { slug: "demo", room: "r-1" };
    render();
    const before = latest.filters;

    // An equivalent but differently written URL must not churn state.
    routerState.query = { slug: "demo", room: "r-1,r-1" };
    rerender();
    expect(latest.filters).toEqual(before);
  });
});
