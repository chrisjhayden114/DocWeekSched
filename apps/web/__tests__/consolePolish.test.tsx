/**
 * @vitest-environment jsdom
 *
 * UX-3 — the four things founder live-testing turned up:
 *   1. sentences were being typed into single-line inputs (the presenter portal
 *      showed about six words of a bio) → one shared AutoGrowTextarea, grows
 *      with the content, keeps the resize handle, used everywhere;
 *   2. the ten-tab console strip wrapped into an orphan second row → one row
 *      that scrolls, with a fade on whichever edge has tabs behind it;
 *   3. /account buried the way out and offered Delete with no confirmation;
 *   4. /speaker-readiness shipped a "founder will supply" placeholder box.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AutoGrowTextarea } from "../components/kit/AutoGrowTextarea";
import { ConsoleTabStrip } from "../components/organizer/ConsoleTabStrip";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const webRoot = join(__dirname, "..");
const read = (...parts: string[]) => readFileSync(join(webRoot, ...parts), "utf8");
const globalsCss = read("styles", "globals.css");
/** Declarations only — comments in the sheet discuss the rules they forbid. */
const globalsDeclarations = globalsCss.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every hand-written .tsx under pages/ and components/, relative to apps/web. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".tsx")) out.push(relative(webRoot, full));
    }
  };
  walk(join(webRoot, "pages"));
  walk(join(webRoot, "components"));
  return out;
}

/** Extracts the body of a braced block starting at the first `{` at/after `start`. */
function blockBody(css: string, start: number): string {
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error("Unbalanced braces");
}

/** The rule as written at the top level of the sheet, not inside a media query. */
function baseRule(selector: string): string {
  const at = globalsCss.indexOf(`\n${selector} {`);
  expect(at, `${selector} must exist as a top-level rule`).toBeGreaterThan(-1);
  return blockBody(globalsCss, at);
}

let root: Root;
let container: HTMLDivElement;
/** Observer callbacks registered by the component under test. */
let resizeCallbacks: (() => void)[];

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no layout: scrollHeight is always 0 and offsetHeight is always 0.
  // Stand in for both — scrollHeight from the line count, offsetHeight from the
  // height the component actually set — so growth is observable.
  Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLTextAreaElement) {
      return this.value.split("\n").length * 20;
    },
  });
  Object.defineProperty(HTMLTextAreaElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLTextAreaElement) {
      return Number.parseFloat(this.style.height) || 0;
    },
  });
  class TestResizeObserver {
    constructor(private readonly cb: () => void) {}
    observe() {
      resizeCallbacks.push(this.cb);
    }
    disconnect() {
      resizeCallbacks = resizeCallbacks.filter((cb) => cb !== this.cb);
    }
    unobserve() {}
  }
  globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  resizeCallbacks = [];
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

/** React's value tracker swallows a plain `el.value = …`; go through the
 *  prototype setter so onChange actually fires, as a keystroke would. */
const nativeSetValue = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype,
  "value",
)!.set!;

function type(el: HTMLTextAreaElement, value: string) {
  act(() => {
    nativeSetValue.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const height = (el: HTMLElement) => Number.parseFloat(el.style.height);

describe("UX-3 #1 — AutoGrowTextarea", () => {
  function mount(props: Record<string, unknown> = {}) {
    render(<AutoGrowTextarea aria-label="Bio" {...props} />);
    return container.querySelector<HTMLTextAreaElement>("textarea")!;
  }

  it("is a textarea, so sentences are never typed into a one-line box", () => {
    const el = mount();
    expect(el).not.toBeNull();
    expect(el.className).toContain("textarea-autogrow");
  });

  it("grows with the content and holds the minRows floor", () => {
    const el = mount({ minRows: 2 });
    const floor = height(el);
    expect(floor).toBeGreaterThan(0);

    type(el, "one\ntwo\nthree\nfour\nfive");
    const grown = height(el);
    expect(grown).toBeGreaterThan(floor);

    type(el, "one");
    expect(height(el)).toBe(floor);
  });

  it("sizes a controlled field from the value it is given, without an edit", () => {
    const short = mount({ minRows: 1, value: "hi", onChange: () => {} });
    const shortHeight = height(short);
    act(() => root.unmount());
    root = createRoot(container);
    const long = mount({ minRows: 1, value: "a\nb\nc\nd\ne\nf", onChange: () => {} });
    expect(height(long)).toBeGreaterThan(shortHeight);
  });

  it("keeps the user's own drag: after a manual resize, typing stops resizing the box", () => {
    const el = mount({ minRows: 2 });
    type(el, "a\nb\nc");
    const auto = height(el);
    // The observer's first callback is the initial observation, which records
    // the width; only later callbacks can be a drag.
    act(() => resizeCallbacks.forEach((cb) => cb()));

    // The drag: a height we did not set, reported through the ResizeObserver.
    act(() => {
      el.style.height = `${auto + 200}px`;
      resizeCallbacks.forEach((cb) => cb());
    });

    type(el, "a");
    expect(height(el)).toBe(auto + 200);
  });

  it("re-measures when a form reset empties it (the reply form clears on send)", () => {
    render(
      <form>
        <AutoGrowTextarea aria-label="Reply" name="body" minRows={2} />
      </form>,
    );
    const el = container.querySelector<HTMLTextAreaElement>("textarea")!;
    const floor = height(el);
    type(el, "a\nb\nc\nd\ne");
    expect(height(el)).toBeGreaterThan(floor);

    act(() => {
      container.querySelector("form")!.reset();
    });
    // The listener defers past the reset, which clears the value.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(height(el)).toBe(floor);
        resolve();
      }, 0);
    });
  });

  it("multi-line fields resize vertically and are never resize: none", () => {
    expect(baseRule(".textarea,\ntextarea.input,\n.textarea-autogrow")).toContain(
      "resize: vertical",
    );
    expect(globalsDeclarations).not.toMatch(/resize:\s*none/);
  });

  it("is the ONLY textarea in the app — no page may hand-roll a fixed-rows one", () => {
    const offenders = sourceFiles().filter(
      (file) =>
        file !== join("components", "kit", "AutoGrowTextarea.tsx") &&
        read(file).includes("<textarea"),
    );
    expect(offenders).toEqual([]);
  });

  it("the presenter portal has no single-line text input left for a bio", () => {
    const portal = read("pages", "r", "[token].tsx");
    // Both prose kinds — long_text AND the short_text fallback the bio arrived as.
    expect(portal).not.toContain('type="text"');
    expect(portal.match(/<AutoGrowTextarea/g)?.length).toBe(2);
  });

  it("the fields the founder named all use the shared component", () => {
    const named: [string[], string][] = [
      [["pages", "r", "[token].tsx"], "portal requirement"],
      [["components", "organizer", "ReadinessTab.tsx"], "readiness help text + template description"],
      [["pages", "dashboard.tsx"], "profile bio/interests, invite description, session description"],
      [["components", "AnnouncementComposer.tsx"], "announcement body"],
      [["components", "organizer", "EventSettingsSlideOver.tsx"], "event description"],
      [["pages", "organizer", "events", "new.tsx"], "event description (wizard)"],
      [["components", "MessagesPanel.tsx"], "message composer + report details"],
      [["pages", "session", "[sessionId].tsx"], "session feedback comment"],
    ];
    for (const [parts, what] of named) {
      expect(read(...parts), what).toContain("AutoGrowTextarea");
    }
  });
});

describe("UX-3 #2 — console tab strip stays one row", () => {
  const TABS = [
    "Overview",
    "Program",
    "Speakers",
    "Participants",
    "Maps",
    "Announcements",
    "Ops Inbox",
    "Readiness",
    "Recap",
    "Features",
  ].map((label) => ({ id: label.toLowerCase(), label }));

  function mountStrip() {
    render(<ConsoleTabStrip tabs={TABS} activeId="overview" onSelect={() => {}} ariaLabel="Event sections" />);
    return {
      wrap: container.querySelector<HTMLElement>(".console-tabstrip")!,
      scroller: container.querySelector<HTMLElement>(".console-event-tabs")!,
    };
  }

  /** jsdom reports 0 for both, i.e. "not scrollable"; fake an overflowing row. */
  function overflow(el: HTMLElement, scrollWidth: number, clientWidth: number) {
    Object.defineProperty(el, "scrollWidth", { configurable: true, value: scrollWidth });
    Object.defineProperty(el, "clientWidth", { configurable: true, value: clientWidth });
  }

  it("renders all ten tabs in a single nav", () => {
    const { scroller } = mountStrip();
    expect(scroller.querySelectorAll("button")).toHaveLength(10);
    expect(container.querySelectorAll("nav")).toHaveLength(1);
    expect(scroller.getAttribute("aria-label")).toBe("Event sections");
  });

  it("never wraps: the row scrolls, and the scrollbar is hidden", () => {
    const strip = baseRule(".console-event-tabs");
    expect(strip).toContain("flex-wrap: nowrap");
    expect(strip).toContain("overflow-x: auto");
    expect(strip).toContain("scrollbar-width: none");
    expect(baseRule(".console-event-tabs::-webkit-scrollbar")).toContain("display: none");
    expect(baseRule(".console-event-tabs button")).toContain("white-space: nowrap");
  });

  it("fades only the edges that have tabs behind them", () => {
    const { wrap, scroller } = mountStrip();
    // Not scrollable: no fade at all.
    expect(wrap.className).not.toContain("has-fade");

    overflow(scroller, 1200, 600);
    act(() => scroller.dispatchEvent(new Event("scroll")));
    expect(wrap.className).toContain("has-fade-end");
    expect(wrap.className).not.toContain("has-fade-start");

    scroller.scrollLeft = 300;
    act(() => scroller.dispatchEvent(new Event("scroll")));
    expect(wrap.className).toContain("has-fade-start");
    expect(wrap.className).toContain("has-fade-end");

    scroller.scrollLeft = 600;
    act(() => scroller.dispatchEvent(new Event("scroll")));
    expect(wrap.className).toContain("has-fade-start");
    expect(wrap.className).not.toContain("has-fade-end");
  });

  it("the console page renders the strip instead of a wrapping nav", () => {
    const page = read("pages", "organizer", "events", "[eventId]", "index.tsx");
    expect(page).toContain("<ConsoleTabStrip");
    expect(page).not.toContain('className="nav console-event-tabs"');
  });
});

describe("UX-3 #3 — /account quick fixes", () => {
  const page = read("pages", "account.tsx");

  it("puts Back to dashboard above the heading, not in the footer", () => {
    const back = page.indexOf("← Back to dashboard");
    expect(back).toBeGreaterThan(-1);
    expect(back).toBeLessThan(page.indexOf("<h1"));
    // The old buried duplicate is gone.
    expect(page.match(/Back to dashboard/g)).toHaveLength(1);
  });

  it("confirms deletion with concrete consequences on top of the re-auth", () => {
    expect(page).toContain("<ConfirmDialog");
    expect(page).toContain('tone="danger"');
    expect(page).toContain(
      "Deactivates immediately; permanently deleted after 7 days including profile, memberships, and messages. Sign in during the 7 days to cancel.",
    );
    expect(page).toContain('confirmLabel="Schedule deletion"');
    // The re-auth fields stay: the dialog is an extra step, not a replacement.
    expect(page).toContain("Confirm email");
    expect(page).toContain("Confirm password");
    // Submitting the form opens the dialog; only the dialog deletes.
    expect(page).toMatch(/onSubmit=\{\(e\) => \{[\s\S]*?setConfirmOpen\(true\)/);
    expect(page).toContain("onConfirm={() => void requestDeletion()}");
  });

  it("quarantines the delete card and keeps the export directly above it", () => {
    expect(page).toContain('className="card danger-zone"');
    expect(page).toContain("Danger zone");
    expect(page.indexOf("Download your data")).toBeLessThan(page.indexOf("danger-zone"));
    expect(baseRule(".card.danger-zone")).toContain("border-color: var(--danger)");
  });
});

describe("UX-3 #4 — the readiness dashboard screenshot is real", () => {
  const page = read("pages", "speaker-readiness.tsx");

  it("ships the founder's image with the promised alt text and caption", () => {
    expect(page).toContain('src="/marketing/readiness-dashboard.png"');
    expect(page).toContain('alt="Readiness dashboard: every presenter at a glance"');
    expect(page).toContain("See the five who are missing something — not the hundred who aren&apos;t.");
  });

  it("leaves no placeholder behind", () => {
    expect(page).not.toContain("Founder will supply");
    expect(page).not.toContain("mkt-screenshot-ph");
    expect(globalsCss).not.toContain("mkt-screenshot-ph");
  });

  it("the file is committed, bordered and rounded", () => {
    const png = readFileSync(join(webRoot, "public", "marketing", "readiness-dashboard.png"));
    expect(png.byteLength).toBeGreaterThan(1000);
    // PNG magic number — a real image, not a text placeholder.
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const rule = baseRule(".mkt-screenshot");
    expect(rule).toContain("border: 1px solid var(--gray-200)");
    expect(rule).toContain("border-radius: var(--radius-lg)");
  });
});
