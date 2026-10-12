/**
 * @vitest-environment jsdom
 *
 * UI-6 — the segment indicator re-settles, without animating, when fonts
 * finish, when the control changes size, and when the tab becomes visible.
 * A genuine active-segment change still uses the FLIP transform.
 */

import { act, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ScheduleViewSwitcher, type ScheduleViewMode } from "../components/ScheduleViewSwitcher";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

type Box = { left: number; top: number; width: number; height: number };

const boxes: Record<string, Box> = {};

function resetBoxes() {
  boxes.List = { left: 0, top: 0, width: 40, height: 32 };
  boxes.Grid = { left: 40, top: 0, width: 48, height: 32 };
  boxes["By room"] = { left: 88, top: 0, width: 70, height: 32 };
}

function boxFor(el: HTMLElement): Box {
  const label = el.textContent?.trim() ?? "";
  return boxes[label] ?? { left: 0, top: 0, width: 0, height: 0 };
}

const offsetProps = ["offsetLeft", "offsetTop", "offsetWidth", "offsetHeight"] as const;
const savedOffsets: PropertyDescriptor[] = [];

class MockResizeObserver implements ResizeObserver {
  els: Element[] = [];
  disconnected = false;

  constructor(readonly callback: ResizeObserverCallback) {
    observers.push(this);
  }

  observe(target: Element) {
    this.els.push(target);
  }

  unobserve(target: Element) {
    this.els = this.els.filter((item) => item !== target);
  }

  disconnect() {
    this.disconnected = true;
    this.els = [];
  }
}

let observers: MockResizeObserver[];
let resolveFonts: () => void;
let readyPromise: Promise<void>;
let visibility: DocumentVisibilityState;

let root: Root;
let container: HTMLDivElement;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  for (const prop of offsetProps) {
    const prev = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
    if (prev) savedOffsets.push(prev);
    const key = prop === "offsetLeft" ? "left" : prop === "offsetTop" ? "top" : prop === "offsetWidth" ? "width" : "height";
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get() {
        return boxFor(this as HTMLElement)[key];
      },
    });
  }
});

afterAll(() => {
  for (let i = 0; i < offsetProps.length; i += 1) {
    const prev = savedOffsets[i];
    if (prev) Object.defineProperty(HTMLElement.prototype, offsetProps[i]!, prev);
  }
});

beforeEach(() => {
  resetBoxes();
  observers = [];
  visibility = "visible";
  readyPromise = new Promise<void>((resolve) => {
    resolveFonts = resolve;
  });
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: readyPromise },
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  globalThis.ResizeObserver = MockResizeObserver;
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

function indicator() {
  return container.querySelector<HTMLElement>(".seg-slide")!;
}

function Harness() {
  const [value, setValue] = useState<ScheduleViewMode>("list");
  return <ScheduleViewSwitcher value={value} onChange={setValue} />;
}

describe("useSegmentSlide re-settle", () => {
  it("re-settles with no animation when document.fonts.ready resolves", async () => {
    render(<ScheduleViewSwitcher value="list" onChange={() => undefined} />);
    expect(indicator().style.left).toBe("0px");
    expect(indicator().style.width).toBe("40px");

    boxes.List = { left: 12, top: 0, width: 90, height: 32 };
    await act(async () => {
      resolveFonts();
      await readyPromise;
    });
    expect(indicator().style.left).toBe("12px");
    expect(indicator().style.width).toBe("90px");
    expect(indicator().style.transform).toBe("");
  });

  it("re-settles with no animation when ResizeObserver fires", () => {
    render(<ScheduleViewSwitcher value="list" onChange={() => undefined} />);
    const observer = observers[0]!;
    expect(observer.els.some((el) => (el as HTMLElement).classList.contains("schedule-view-switcher"))).toBe(true);
    expect(observer.els.some((el) => (el as HTMLElement).classList.contains("active"))).toBe(true);

    boxes.List = { left: 6, top: 0, width: 77, height: 32 };
    act(() => {
      observer.callback([], observer);
    });
    expect(indicator().style.left).toBe("6px");
    expect(indicator().style.width).toBe("77px");
    expect(indicator().style.transform).toBe("");
  });

  it("re-settles with no animation when the document becomes visible", () => {
    render(<ScheduleViewSwitcher value="list" onChange={() => undefined} />);
    boxes.List = { left: 8, top: 0, width: 64, height: 32 };

    visibility = "hidden";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(indicator().style.left).toBe("0px");
    expect(indicator().style.width).toBe("40px");

    visibility = "visible";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(indicator().style.left).toBe("8px");
    expect(indicator().style.width).toBe("64px");
    expect(indicator().style.transform).toBe("");
  });

  it("falls back to a window resize listener when ResizeObserver is missing", () => {
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    render(<ScheduleViewSwitcher value="list" onChange={() => undefined} />);
    boxes.List = { left: 3, top: 0, width: 55, height: 32 };
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(indicator().style.left).toBe("3px");
    expect(indicator().style.width).toBe("55px");
    expect(indicator().style.transform).toBe("");
  });

  it("keeps the FLIP transform when the active segment changes", () => {
    render(<Harness />);
    expect(indicator().style.left).toBe("0px");
    expect(indicator().style.transform).toBe("");

    const grid = [...container.querySelectorAll("button")].find((button) => button.textContent === "Grid")!;
    act(() => {
      grid.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(indicator().style.left).toBe("0px");
    expect(indicator().style.transform).toBe("translate(40px, 0px) scale(1.2, 1)");
  });
});
