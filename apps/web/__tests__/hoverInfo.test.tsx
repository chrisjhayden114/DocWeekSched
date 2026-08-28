/**
 * @vitest-environment jsdom
 *
 * K-1 — HoverInfo mounts its popover in kit/Portal and opens/closes from the
 * keyboard (focusin immediate, Escape, blur). Hover delay is not asserted here.
 */

import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HoverInfo } from "../components/kit/HoverInfo";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let root: Root;
let container: HTMLDivElement;
let clipper: HTMLDivElement;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
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

function press(target: EventTarget, key: string) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

function tooltip() {
  return document.querySelector<HTMLElement>('[role="tooltip"]');
}

describe("HoverInfo", () => {
  function mount() {
    render(
      <HoverInfo title="Community" body="The whole Community section where people post and reply." appearsIn="Community tab">
        <strong>Community</strong>
      </HoverInfo>,
    );
    return clipper.querySelector<HTMLButtonElement>(".hover-info-trigger")!;
  }

  it("mounts the popover in the portal root, outside a clipping ancestor", () => {
    const trigger = mount();
    act(() => trigger.focus());

    const popover = tooltip();
    expect(popover).not.toBeNull();
    expect(popover!.parentElement).toBe(document.body);
    expect(clipper.contains(popover)).toBe(false);
    expect(popover!.style.position).toBe("fixed");
    expect(popover!.textContent).toContain("Community");
    expect(popover!.textContent).toContain("The whole Community section");
    expect(popover!.textContent).toContain("Appears in: Community tab");
  });

  it("opens on focus with no delay and wires aria-describedby to the tooltip", () => {
    const trigger = mount();
    expect(tooltip()).toBeNull();
    expect(trigger.getAttribute("aria-describedby")).toBeNull();

    act(() => trigger.focus());

    const popover = tooltip()!;
    expect(popover).not.toBeNull();
    expect(trigger.getAttribute("aria-describedby")).toBe(popover.id);
    expect(document.getElementById(popover.id)).toBe(popover);
  });

  it("closes on Escape and restores focus to the trigger", () => {
    const trigger = mount();
    act(() => trigger.focus());
    expect(tooltip()).not.toBeNull();

    press(window, "Escape");
    expect(tooltip()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on blur", () => {
    const trigger = mount();
    act(() => trigger.focus());
    expect(tooltip()).not.toBeNull();

    act(() => trigger.blur());
    expect(tooltip()).toBeNull();
  });
});

describe("HoverInfo trigger=label", () => {
  function mountLabel() {
    render(
      <HoverInfo trigger="label" hideIcon title="Community" body="Channels, who can post, and how it differs from Messages.">
        <strong>Community</strong>
      </HoverInfo>,
    );
    return clipper.querySelector<HTMLButtonElement>(".hover-info-label")!;
  }

  it("uses the title as the trigger — no ⓘ in the tree", () => {
    const trigger = mountLabel();
    expect(trigger).not.toBeNull();
    expect(trigger.textContent).toContain("Community");
    expect(clipper.textContent).not.toContain("ⓘ");
    expect(clipper.querySelector(".hover-info-trigger")).toBeNull();
  });

  it("opens on focus and closes on Escape, restoring focus to the title", () => {
    const trigger = mountLabel();
    expect(tooltip()).toBeNull();

    act(() => trigger.focus());
    const popover = tooltip()!;
    expect(popover).not.toBeNull();
    expect(popover.textContent).toContain("Channels, who can post");
    expect(popover.textContent).not.toContain("Appears in");
    expect(trigger.getAttribute("aria-describedby")).toBe(popover.id);

    press(window, "Escape");
    expect(tooltip()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
