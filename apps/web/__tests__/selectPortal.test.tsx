/**
 * @vitest-environment jsdom
 *
 * W-1 — the Select listbox and the KebabMenu panel must mount in the portal
 * root (document.body), not inside the control. As absolutely positioned
 * children they were clipped by any scrolling ancestor: the roster's
 * participant-label dropdown, sitting in .console-table-wrap, showed a sliver.
 *
 * These tests reproduce that ancestor and assert the popups escape it, plus the
 * behaviour that living outside the control could plausibly break — committing
 * an option, invoking a menu item, and closing.
 */

import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { KebabMenu } from "../components/KebabMenu";
import { Select } from "../components/Select";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let root: Root;
let container: HTMLDivElement;
/** Stands in for .console-table-wrap — the overflow ancestor that did the clipping. */
let clipper: HTMLDivElement;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no layout, so the Select's active-option scrolling is a no-op here.
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
});

beforeEach(() => {
  container = document.createElement("div");
  clipper = document.createElement("div");
  clipper.className = "console-table-wrap";
  clipper.style.overflowX = "auto";
  container.appendChild(clipper);
  document.body.appendChild(container);
  root = createRoot(clipper);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(element: ReactElement) {
  act(() => root.render(element));
}

function fire(target: Element, type: string) {
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
  });
}

function press(target: Element, key: string) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

function byRole(role: string) {
  return document.querySelector<HTMLElement>(`[role="${role}"]`);
}

function allByRole(role: string) {
  return [...document.querySelectorAll<HTMLElement>(`[role="${role}"]`)];
}

const options = [
  { value: "attendee", label: "Attendee" },
  { value: "speaker", label: "Speaker" },
];

describe("Select listbox", () => {
  function openSelect(onChange?: (value: string) => void) {
    render(<Select options={options} aria-label="Participant label" onChange={onChange} />);
    const trigger = clipper.querySelector<HTMLButtonElement>(".select-trigger");
    expect(trigger).not.toBeNull();
    fire(trigger!, "click");
    return trigger!;
  }

  it("mounts the listbox in the portal root, outside the clipping ancestor", () => {
    const trigger = openSelect();
    const listbox = byRole("listbox");

    expect(listbox).not.toBeNull();
    expect(listbox!.parentElement).toBe(document.body);
    expect(clipper.contains(listbox)).toBe(false);
    expect(trigger.closest(".select-control")!.contains(listbox)).toBe(false);
  });

  it("positions the listbox against the trigger with fixed coordinates", () => {
    openSelect();
    const listbox = byRole("listbox")!;

    expect(listbox.style.position).toBe("fixed");
    expect(listbox.style.top).not.toBe("");
    expect(listbox.style.maxHeight).not.toBe("");
  });

  it("keeps the trigger's ARIA wiring pointed at the portalled listbox", () => {
    const trigger = openSelect();
    const listbox = byRole("listbox")!;

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(listbox.id);
    expect(document.getElementById(listbox.id)).toBe(listbox);
  });

  it("still commits an option clicked inside the portal", () => {
    const onChange = vi.fn();
    openSelect(onChange);
    const speaker = allByRole("option").find((el) => el.textContent?.includes("Speaker"))!;

    fire(speaker, "mousedown");

    expect(onChange).toHaveBeenCalledWith("speaker");
    expect(byRole("listbox")).toBeNull();
  });

  it("closes on Escape and on a click outside, leaving nothing in the portal", () => {
    const trigger = openSelect();
    press(trigger, "Escape");
    expect(byRole("listbox")).toBeNull();

    fire(trigger, "click");
    expect(byRole("listbox")).not.toBeNull();
    fire(document.body, "mousedown");
    expect(byRole("listbox")).toBeNull();
  });

  it("closes when the clipping ancestor scrolls out from under it", () => {
    openSelect();
    act(() => {
      clipper.dispatchEvent(new Event("scroll"));
    });
    expect(byRole("listbox")).toBeNull();
  });
});

describe("KebabMenu panel", () => {
  const onRemove = vi.fn();
  const items = [
    { id: "remove", label: "Remove", onSelect: onRemove },
    { id: "resend", label: "Resend invite", onSelect: vi.fn() },
  ];

  function openMenu() {
    render(<KebabMenu items={items} label="Actions for Ada" />);
    const trigger = clipper.querySelector<HTMLButtonElement>(".kebab-trigger")!;
    fire(trigger, "click");
    return trigger;
  }

  it("mounts the panel in the portal root, outside the clipping ancestor", () => {
    openMenu();
    const panel = byRole("menu");

    expect(panel).not.toBeNull();
    expect(panel!.parentElement).toBe(document.body);
    expect(clipper.contains(panel)).toBe(false);
    expect(panel!.style.position).toBe("fixed");
  });

  it("runs a menu item: the outside-click guard must not unmount it mid-gesture", () => {
    openMenu();
    const remove = allByRole("menuitem").find((el) => el.textContent === "Remove")!;

    // The real gesture: mousedown lands on the portalled item, then click. If the
    // outside-click guard treated the portal as outside, mousedown would unmount
    // the item and the click would never reach it.
    fire(remove, "mousedown");
    expect(byRole("menu")).not.toBeNull();
    fire(remove, "click");

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(byRole("menu")).toBeNull();
  });
});
