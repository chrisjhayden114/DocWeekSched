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
import { brand } from "@event-app/config";
import { FEATURE_BY_KEY, FEATURE_GUIDE, type FeatureKey } from "@event-app/shared";
import { FeatureConfigPanel } from "../components/FeatureConfigPanel";
import { GuidePanel } from "../components/kit/GuidePanel";
import { HoverInfo } from "../components/kit/HoverInfo";

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
  it("prefetches every wired guide screenshot once after mount", () => {
    const seen: string[] = [];
    class FakeImage {
      set src(value: string) {
        seen.push(value);
      }
    }
    vi.stubGlobal("Image", FakeImage);
    try {
      render(<FeatureConfigPanel overrides={{}} onChange={() => undefined} confirmOff={false} />);
      expect(seen).toEqual(
        expect.arrayContaining([
          "/feature-guide/community.png",
          "/feature-guide/community_meetups.png",
          "/feature-guide/community_moments.jpg",
          "/feature-guide/community_local.png",
          "/feature-guide/community_icebreakers.png",
          "/feature-guide/community_general.png",
          "/feature-guide/concierge.png",
          "/feature-guide/cfp.png",
          "/feature-guide/readiness.png",
          "/feature-guide/engagement_points.png",
          "/feature-guide/certificates.png",
          "/feature-guide/venue_maps.png",
          "/feature-guide/session_feedback.png",
          "/feature-guide/sponsor_outreach.png",
        ]),
      );
      expect(new Set(seen).size).toBe(seen.length);
    } finally {
      vi.unstubAllGlobals();
    }
  });

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
    expect(panel.parentElement).toBe(document.body);
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
    expect(panel.parentElement).toBe(document.body);
    expect(panel.querySelector(".drawer-header")?.textContent).toContain("Community");
    expect(panel.textContent).toContain("What it does");
    expect(panel.textContent).toContain("The experience");
    expect(panel.textContent).toContain("Good to know");
    act(() => panel.querySelector<HTMLButtonElement>(".drawer-close")!.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("Session Q&A GuidePanel header (title + close) is on the portaled panel", () => {
    function Harness() {
      return <GuidePanel featureKey="session_qa" open onClose={() => undefined} />;
    }
    render(<Harness />);
    const panel = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(panel.parentElement).toBe(document.body);
    const header = panel.querySelector(".drawer-header")!;
    expect(header.textContent).toContain("Session Q&A");
    expect(header.querySelector(".drawer-close")).not.toBeNull();
    expect(panel.textContent).toContain("What it does");
  });

  it("HELP-2.1 — GuidePanel and HoverInfo substitute {{product}} in Feature Guide copy", () => {
    render(<GuidePanel featureKey="sponsor_outreach" open onClose={() => undefined} />);
    const panel = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(FEATURE_GUIDE.sponsor_outreach.whatItDoes).toContain("{{product}}");
    expect(panel.textContent).toContain(brand.productName);
    expect(panel.textContent).not.toContain("{{product}}");
    act(() => panel.querySelector<HTMLButtonElement>(".drawer-close")!.click());

    render(<FeatureConfigPanel overrides={{}} onChange={() => undefined} confirmOff={false} />);
    const trigger = [...container.querySelectorAll<HTMLButtonElement>(".hover-info-label")].find((el) =>
      el.textContent?.includes("Sponsor outreach"),
    )!;
    act(() => trigger.focus());
    const popover = document.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(popover.textContent).toContain(brand.productName);
    expect(popover.textContent).not.toContain("{{product}}");
  });

  it("K-8 — longest FEATURE_GUIDE + image + footer: footer is in the DOM and not inside the body", () => {
    const longestKey = (Object.keys(FEATURE_GUIDE) as FeatureKey[]).reduce((best, key) =>
      FEATURE_GUIDE[key].whatItDoes.length > FEATURE_GUIDE[best].whatItDoes.length ? key : best,
    );
    const longest = FEATURE_GUIDE[longestKey];
    render(
      <HoverInfo
        trigger="label"
        title={FEATURE_BY_KEY[longestKey].name}
        featureKey={longestKey}
        body={longest.whatItDoes}
        imageSrc={longest.imageSrc}
        image={<svg className="feature-art" viewBox="0 0 400 225" />}
      >
        <strong>{FEATURE_BY_KEY[longestKey].name}</strong>
      </HoverInfo>,
    );
    act(() => container.querySelector<HTMLButtonElement>(".hover-info-label")!.focus());
    const card = document.querySelector<HTMLElement>('[role="tooltip"]')!;
    const footer = card.querySelector<HTMLElement>('[data-hover-slot="footer"]');
    const body = card.querySelector<HTMLElement>('[data-hover-slot="body"]');
    const title = card.querySelector<HTMLElement>('[data-hover-slot="title"]');
    expect(card.querySelector('[data-hover-slot="art"]')).not.toBeNull();
    expect(title?.textContent).toBe(FEATURE_BY_KEY[longestKey].name);
    expect(title?.classList.contains("hover-info-title")).toBe(true);
    expect(body?.textContent).toBe(longest.whatItDoes);
    expect(body?.classList.contains("hover-info-body")).toBe(true);
    expect(footer).not.toBeNull();
    expect(footer?.classList.contains("hover-info-action")).toBe(true);
    expect(footer?.textContent).toContain("How to use this feature");
    expect(body?.contains(footer)).toBe(false);
    expect(Number.parseFloat(card.style.maxHeight)).toBe(480);
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
    expect(src).toContain("applyBrandTokens(FEATURE_GUIDE[f.key].whatItDoes)");
    expect(src).toContain("FEATURE_GUIDE[f.key].whatItDoes");
    expect(src).toContain('trigger="label"');
    expect(src).toContain("hideIcon");
    expect(src).toContain("featureKey={f.key}");
    expect(src).toContain("FeatureArt");
    expect(src).not.toMatch(/HoverInfo[^>]*appearsIn/);
    expect(src).not.toMatch(/HoverInfo[^>]*body=\{f\.plainDescription\}/);
    const hover = read("components", "kit", "HoverInfo.tsx");
    expect(hover).toContain("GuidePanel");
    expect(hover).toContain("HOVER_INFO_GUIDE_ACTION");
    expect(hover).toContain("maxHeight: HOVER_INFO_CARD_MAX_HEIGHT");
  });

  it("the feature-guide page renders imageSrc with lazy loading, else category art", () => {
    const page = read("pages", "help", "feature-guide.tsx");
    // SHOT-CI: resolution moved behind featureGuideImage() so a committed
    // /feature-guide/auto/<key>.png can stand in for missing manual art.
    expect(page).toContain("featureGuideImage(key)");
    expect(page).toContain('loading="lazy"');
    expect(page).toContain("<FeatureArt category={group.category} />");
    expect(page).not.toContain("Retired — kept here so the key stays documented.");
    // UI-2 — name, then image, then sections. Planned entries are text-only.
    const nameAt = page.indexOf("{def.name}");
    const artAt = page.indexOf("feature-guide-page-art");
    const sectionsAt = page.indexOf("<FeatureGuideSections");
    expect(nameAt).toBeGreaterThan(-1);
    expect(artAt).toBeGreaterThan(nameAt);
    expect(sectionsAt).toBeGreaterThan(artAt);
    expect(page).toContain("feature-guide-category");
    expect(page).toContain("def.plannedPhase");
    expect(page).toContain("!planned && !imageSrc");
    expect(page).toContain("!planned && imageSrc");
  });

  it("K-8 — Features rows, sidebar, and console tabs with a guide entry pass featureKey", () => {
    expect(read("components", "FeatureConfigPanel.tsx")).toContain("featureKey={f.key}");
    expect(read("components", "AppShell.tsx")).toContain("featureKey={item.featureKey}");
    expect(read("components", "organizer", "ConsoleTabStrip.tsx")).toContain("featureKey={tab.featureKey}");
    const shell = read("components", "OrganizerShell.tsx");
    expect(shell).toContain('featureKey: "cfp"');
    expect(shell).toContain('featureKey: "sponsors"');
    expect(shell).toContain('featureKey: "checkin"');
    const dash = read("pages", "dashboard.tsx");
    expect(dash).toContain("ATTENDEE_TAB_FEATURE");
    expect(dash).toContain("featureKey: ATTENDEE_TAB_FEATURE");
    const consolePage = read("pages", "organizer", "events", "[eventId]", "index.tsx");
    expect(consolePage).toContain('featureKey: "venue_maps"');
    expect(consolePage).toContain('featureKey: "ops_agent"');
    expect(consolePage).toContain('featureKey: "recap_agent"');
    expect(consolePage).toContain('featureKey: "readiness"');
  });

  it("K-8 — privacy drops the internal cookie flag; security states AI control", () => {
    const privacy = read("pages", "privacy.tsx");
    expect(privacy).not.toContain("see brand.cookieConsentRequired in config");
    const security = read("pages", "security.tsx");
    expect(security).toContain("Every AI feature can be switched off per event by the organizer");
    expect(security).toContain("Event assistant answers only from the published content of that event");
  });

  it("HELP-2.1 — GuidePanel and the feature-guide page apply brand tokens to guide copy", () => {
    const guide = read("components", "kit", "GuidePanel.tsx");
    expect(guide).toContain("applyBrandTokens(guide.whatItDoes)");
    expect(guide).toContain("applyBrandTokens(guide.experience)");
    expect(guide).toContain("applyBrandTokens(guide.goodToKnow)");
    const page = read("pages", "help", "feature-guide.tsx");
    expect(page).toContain("FeatureGuideSections");
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

  it("gives the preview image a fixed ~170px height so it never shrinks; title, body, and footer stay visible", () => {
    expect(rule(".hover-info-art")).toContain("height: 170px");
    expect(rule(".hover-info-art")).toContain("flex-shrink: 0");
    expect(rule(".hover-info-art")).toContain("overflow: hidden");
    expect(rule(".hover-info-art")).not.toContain("flex-shrink: 1");
    expect(rule(".hover-info-art")).not.toContain("min-height: 0");
    expect(rule(".hover-info-image,\n.hover-info-art img")).toContain("object-fit: cover");
    expect(rule(".hover-info-image,\n.hover-info-art img")).toContain("object-position: left top");
    expect(rule(".hover-info-popover")).toContain("max-height: 480px");
    expect(rule(".hover-info-title")).toContain("overflow: visible");
    expect(rule(".hover-info-title")).toContain("flex-shrink: 0");
    expect(rule(".hover-info-inner")).toContain("flex: 1 1 auto");
    expect(rule(".hover-info-inner")).toContain("min-height: 0");
    expect(rule(".hover-info-body")).toContain("flex: 1 1 auto");
    expect(rule(".hover-info-body")).toContain("min-height: 0");
    expect(rule(".hover-info-body")).toContain("overflow: hidden");
    expect(rule(".hover-info-body")).toContain("calc(15px * 1.5 * 6)");
    expect(rule(".hover-info-body")).not.toContain("flex-shrink: 0");
    expect(rule(".hover-info-action")).toContain("flex: 0 0 auto");
    expect(rule(".hover-info-action")).toContain("flex-shrink: 0");
    const longest = Object.values(FEATURE_GUIDE).reduce((a, b) =>
      a.whatItDoes.length >= b.whatItDoes.length ? a : b,
    );
    expect(longest.whatItDoes.length).toBeGreaterThan(180);
  });

  it("K-6.1: hover-card triggers keep the normal arrow (no cursor:help)", () => {
    expect(globalsCss).not.toContain("cursor: help");
    expect(rule(".hover-info-trigger")).toContain("cursor: default");
    expect(rule(".hover-info-label")).toContain("cursor: default");
    expect(rule(".hover-info-label-slot")).toContain("cursor: default");
  });

  it("UI-2 — the guide page shows the whole image; hover cards keep the 170px cover band", () => {
    const pageArt = rule(".feature-guide-page-art img,\n.feature-guide-page-art .feature-art");
    expect(pageArt).toContain("max-height: 520px");
    expect(pageArt).toContain("height: auto");
    expect(pageArt).toContain("max-width: 100%");
    expect(pageArt).toContain("object-fit: contain");
    expect(pageArt).not.toContain("object-fit: cover");
    expect(pageArt).toContain("border: 1px solid var(--gray-200)");
    expect(pageArt).toContain("border-radius: var(--radius-card)");
    expect(rule(".feature-guide-page-art")).toContain("justify-content: center");
    // Hover cards crop; the guide page does not. Titles stay via left top.
    expect(rule(".hover-info-art")).toContain("height: 170px");
    expect(rule(".hover-info-image,\n.hover-info-art img")).toContain("object-fit: cover");
    expect(rule(".hover-info-image,\n.hover-info-art img")).toContain("object-position: left top");
    expect(rule(".hover-info-art.is-wide")).toContain("align-items: center");
    expect(rule(".hover-info-art.is-wide .hover-info-image,\n.hover-info-art.is-wide img")).toContain(
      "height: auto",
    );
    expect(rule(".hover-info-art.is-wide .hover-info-image,\n.hover-info-art.is-wide img")).toContain(
      "width: 100%",
    );
  });

  it("UI-2 — category headings are underlined and heavier than feature names", () => {
    const heading = rule(".mkt-prose h2.feature-guide-category");
    expect(heading).toContain("font-weight: 700");
    expect(heading).toMatch(/border-bottom:\s*1px solid/);
    expect(rule(".mkt-prose h3")).toContain("font: 600");
  });

  it("the icebreaker carousel is a fixed viewport with internal scroll", () => {
    expect(rule(".break-ice")).toContain("min-width: 0");
    expect(rule(".break-ice-carousel")).toContain("overflow-x: hidden");
    expect(rule(".break-ice-track")).toContain("overflow-x: auto");
    expect(rule(".shell-content")).toContain("min-width: 0");
  });
});
