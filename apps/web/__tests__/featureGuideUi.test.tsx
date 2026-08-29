/**
 * @vitest-environment jsdom
 *
 * K-2.1 — GuidePanel opens/closes in place; Features tab never renders ⓘ
 * in hover-capable mode; popover body is the guide, not plainDescription.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, useState, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FEATURE_BY_KEY, FEATURE_GUIDE } from "@event-app/shared";
import { FeatureConfigPanel } from "../components/FeatureConfigPanel";
import { GuidePanel } from "../components/kit/GuidePanel";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

function mockHoverMedia(matches: boolean) {
  window.matchMedia = ((query: string) =>
    ({
      matches: query.includes("hover: hover") ? matches : false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
}

let root: Root;
let container: HTMLDivElement;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  mockHoverMedia(true);
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

describe("K-2.1 — Features tab + GuidePanel", () => {
  it("renders no ⓘ on the Features panel in hover-capable mode", () => {
    render(<FeatureConfigPanel overrides={{}} onChange={() => undefined} confirmOff={false} />);
    expect(container.textContent).not.toContain("ⓘ");
    expect(container.querySelector(".hover-info-trigger")).toBeNull();
    expect(container.querySelectorAll(".hover-info-label").length).toBeGreaterThan(0);
  });

  it("popover shows whatItDoes (not plainDescription, not Appears in) and opens GuidePanel", () => {
    render(<FeatureConfigPanel overrides={{}} onChange={() => undefined} confirmOff={false} />);
    const trigger = container.querySelector<HTMLButtonElement>(".hover-info-label")!;
    expect(trigger.textContent).toContain("Community");

    act(() => trigger.focus());
    const popover = document.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(popover).not.toBeNull();
    expect(popover.textContent).toContain(FEATURE_GUIDE.community.whatItDoes.slice(0, 40));
    expect(popover.textContent).not.toContain(FEATURE_BY_KEY.community.plainDescription);
    expect(popover.textContent).not.toContain("Appears in");
    expect(popover.textContent).toContain("How to use this feature");

    const readGuide = popover.querySelector("button")!;
    act(() => readGuide.click());

    const panel = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(panel).not.toBeNull();
    expect(panel.textContent).toContain("Community");
    expect(panel.textContent).toContain("What it does");
    expect(panel.textContent).toContain(FEATURE_GUIDE.community.experience.slice(0, 32));
    expect(panel.textContent).toContain("Open the full Feature Guide");
    expect(panel.querySelector("a")?.getAttribute("href")).toBe("/help/feature-guide#community");

    const close = panel.querySelector<HTMLButtonElement>(".drawer-close")!;
    act(() => close.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("GuidePanel itself opens and closes in place", () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return <GuidePanel featureKey="community" open={open} onClose={() => setOpen(false)} />;
    }
    render(<Harness />);
    const panel = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(panel.textContent).toContain("What it does");
    expect(panel.textContent).toContain("The experience");
    expect(panel.textContent).toContain("Good to know");
    act(() => panel.querySelector<HTMLButtonElement>(".drawer-close")!.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe("K-2.1 — wiring (one source, no md duplicate)", () => {
  const webRoot = join(__dirname, "..");
  const read = (...parts: string[]) => readFileSync(join(webRoot, ...parts), "utf8");

  it("the Features tab and help index link to the React guide page", () => {
    const features = read("pages", "organizer", "events", "[eventId]", "index.tsx");
    const help = read("pages", "help", "index.tsx");
    const page = read("pages", "help", "feature-guide.tsx");
    expect(features).toContain('href="/help/feature-guide"');
    expect(help).toContain('href="/help/feature-guide"');
    expect(page).toContain("featureGuideGroups");
    expect(page).toContain("FeatureGuideSections");
    expect(page).toContain("FeatureArt");
    expect(page).not.toContain("helpContent");
    expect(page).not.toContain("getHelpArticle");
    const shell = read("components", "AppShell.tsx");
    expect(shell).toContain('trigger="label"');
    expect(shell).toContain("appearsIn={item.appearsIn}");
    expect(shell).not.toContain("ⓘ");
  });

  it("FeatureConfigPanel popovers use the guide, never appearsIn or plainDescription", () => {
    const src = read("components", "FeatureConfigPanel.tsx");
    expect(src).toContain("FEATURE_GUIDE[f.key].whatItDoes");
    expect(src).toContain('trigger="label"');
    expect(src).toContain("hideIcon");
    expect(src).toContain("GuidePanel");
    expect(src).toContain("FeatureArt");
    expect(src).toContain("How to use this feature");
    expect(src).not.toMatch(/HoverInfo[^>]*appearsIn/);
    expect(src).not.toMatch(/HoverInfo[^>]*body=\{f\.plainDescription\}/);
  });

  it("the feature-guide page renders imageSrc with lazy loading, else category art", () => {
    const page = read("pages", "help", "feature-guide.tsx");
    expect(page).toContain("guide.imageSrc");
    expect(page).toContain('loading="lazy"');
    expect(page).toContain("<FeatureArt category={group.category} />");
  });
});

describe("K-6 — feature card + carousel CSS", () => {
  const globalsCss = readFileSync(join(__dirname, "..", "styles", "globals.css"), "utf8");

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

  function rule(selector: string): string {
    const at = globalsCss.indexOf(`\n${selector} {`);
    expect(at, `${selector} must exist`).toBeGreaterThan(-1);
    return blockBody(globalsCss, at);
  }

  it("caps the preview image at ~150px and the card at ~480px so title, body, and footer stay visible", () => {
    expect(rule(".hover-info-art")).toContain("150px");
    expect(rule(".hover-info-popover")).toContain("max-height: 480px");
    expect(rule(".hover-info-title")).toContain("overflow: visible");
    expect(rule(".hover-info-body")).toContain("calc(15px * 1.5 * 6)");
    expect(rule(".hover-info-action")).toContain("flex: 0 0 auto");
  });

  it("the icebreaker carousel is a fixed viewport with internal scroll", () => {
    expect(rule(".break-ice")).toContain("min-width: 0");
    expect(rule(".break-ice-carousel")).toContain("overflow-x: hidden");
    expect(rule(".break-ice-track")).toContain("overflow-x: auto");
    expect(rule(".shell-content")).toContain("min-width: 0");
  });
});
