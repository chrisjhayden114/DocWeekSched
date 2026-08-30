/**
 * SHOT-CI.3 — the frame math is what stops a capture run from filing a 250px
 * gem badge and a 2000px console tab as the same kind of picture. It runs
 * inside a browser during a capture, so these tests pin it without one.
 */

import { describe, expect, it } from "vitest";
import {
  DOCKED_BODY_CLASSES,
  FRAME_MAX_UPSCALE,
  PAGE_SCOPE_SELECTORS,
  PAGE_SCOPE_TOP_PAD,
  cleanStageCss,
  composedFrame,
  composedFrameHtml,
  isAssistantOpenStorageKey,
  isPageScopeSelector,
  needsComposedFrame,
  pngSize,
  stageHideSelectors,
} from "../screenshot-frame";
import {
  SCREENSHOT_MANIFEST,
  SCREENSHOT_MAX_HEIGHT,
  SCREENSHOT_MIN_HEIGHT,
  SCREENSHOT_WIDTH,
} from "../screenshot-manifest";

/** Real element sizes, roughly as the surfaces they name measure at 1440px. */
const SOURCES = {
  gem: { width: 248, height: 40 },
  shortCard: { width: 1040, height: 210 },
  card: { width: 1040, height: 604 },
  wide: { width: 1392, height: 512 },
  tall: { width: 1040, height: 2140 },
  overWideAndTall: { width: 1600, height: 1800 },
  exactFrame: { width: SCREENSHOT_WIDTH, height: 520 },
};

describe("composed frames are always card-shaped", () => {
  it("puts every input on a 1200-wide stage between 380 and 760 tall", () => {
    for (const [name, source] of Object.entries(SOURCES)) {
      const { stage } = composedFrame(source);
      expect(stage.width, name).toBe(SCREENSHOT_WIDTH);
      expect(stage.height, name).toBeGreaterThanOrEqual(SCREENSHOT_MIN_HEIGHT);
      expect(stage.height, name).toBeLessThanOrEqual(SCREENSHOT_MAX_HEIGHT);
      expect(Number.isInteger(stage.height), name).toBe(true);
    }
  });

  it("never lets the image hang off the left or the right of the stage", () => {
    for (const [name, source] of Object.entries(SOURCES)) {
      const { stage, image, offset } = composedFrame(source);
      expect(offset.x, name).toBeGreaterThanOrEqual(0);
      expect(offset.x + image.width, name).toBeLessThanOrEqual(stage.width);
      expect(image.width, name).toBeGreaterThan(0);
      expect(image.height, name).toBeGreaterThan(0);
    }
  });

  it("keeps the source's aspect ratio, so nothing is stretched", () => {
    for (const [name, source] of Object.entries(SOURCES)) {
      const { image } = composedFrame(source);
      const before = source.width / source.height;
      const after = image.width / image.height;
      expect(Math.abs(after - before), name).toBeLessThan(0.02 * before);
    }
  });
});

describe("small shots", () => {
  it("enlarges a badge-sized shot instead of leaving a speck on a wide canvas", () => {
    const { stage, image, offset, cropTop } = composedFrame(SOURCES.gem);
    expect(stage.height).toBe(SCREENSHOT_MIN_HEIGHT);
    expect(image.width).toBe(SOURCES.gem.width * FRAME_MAX_UPSCALE);
    expect(image.width / stage.width).toBeGreaterThan(0.5);
    // Centred both ways: a small frame is a portrait of the component.
    expect(offset.x).toBe(Math.round((stage.width - image.width) / 2));
    expect(offset.y).toBeGreaterThan(0);
    expect(cropTop).toBe(false);
  });

  it("caps the enlargement so a shot never turns into mush", () => {
    const { image } = composedFrame({ width: 20, height: 12 });
    expect(image.width).toBe(20 * FRAME_MAX_UPSCALE);
  });

  it("pads a short-but-wide card up to the floor rather than scaling it", () => {
    const { stage, image, offset } = composedFrame(SOURCES.shortCard);
    expect(stage.height).toBe(SCREENSHOT_MIN_HEIGHT);
    expect(image).toEqual(SOURCES.shortCard);
    expect(offset.y).toBe(Math.round((SCREENSHOT_MIN_HEIGHT - SOURCES.shortCard.height) / 2));
  });
});

describe("large shots", () => {
  it("leaves a card that already fits at its own scale", () => {
    const { stage, image } = composedFrame(SOURCES.card);
    expect(stage.height).toBe(SOURCES.card.height);
    expect(image).toEqual(SOURCES.card);
  });

  it("shrinks an over-wide shot to the frame width", () => {
    const { stage, image, cropTop } = composedFrame(SOURCES.wide);
    expect(image.width).toBe(SCREENSHOT_WIDTH);
    expect(image.height).toBeLessThan(SOURCES.wide.height);
    expect(image.height).toBeLessThanOrEqual(stage.height);
    expect(cropTop).toBe(false);
  });
});

describe("tall shots", () => {
  it("shows the top of a long surface rather than shrinking it to a poster", () => {
    const { stage, image, offset, cropTop } = composedFrame(SOURCES.tall);
    expect(stage.height).toBe(SCREENSHOT_MAX_HEIGHT);
    expect(image).toEqual(SOURCES.tall);
    expect(cropTop).toBe(true);
    expect(offset.y).toBe(0);
  });

  it("still fits the width first when a tall shot is also over-wide", () => {
    const { stage, image, cropTop } = composedFrame(SOURCES.overWideAndTall);
    expect(image.width).toBe(SCREENSHOT_WIDTH);
    expect(cropTop).toBe(true);
    expect(image.height).toBeGreaterThan(stage.height);
  });
});

describe("when a frame is needed at all", () => {
  it("writes an already-legal image straight out", () => {
    expect(needsComposedFrame(SOURCES.exactFrame)).toBe(false);
    expect(needsComposedFrame({ width: SCREENSHOT_WIDTH, height: SCREENSHOT_MIN_HEIGHT })).toBe(
      false,
    );
    expect(needsComposedFrame({ width: SCREENSHOT_WIDTH, height: SCREENSHOT_MAX_HEIGHT })).toBe(
      false,
    );
  });

  it("re-stages anything off-width or outside the height band", () => {
    expect(needsComposedFrame(SOURCES.gem)).toBe(true);
    expect(needsComposedFrame(SOURCES.card)).toBe(true);
    expect(
      needsComposedFrame({ width: SCREENSHOT_WIDTH, height: SCREENSHOT_MIN_HEIGHT - 1 }),
    ).toBe(true);
    expect(
      needsComposedFrame({ width: SCREENSHOT_WIDTH, height: SCREENSHOT_MAX_HEIGHT + 1 }),
    ).toBe(true);
  });

  it("composes an image that needed a frame into one that no longer does", () => {
    for (const source of Object.values(SOURCES)) {
      const { stage } = composedFrame(source);
      expect(needsComposedFrame(stage)).toBe(false);
    }
  });
});

describe("the composed stage document", () => {
  it("positions the image and paints the gutters the surface's own colour", () => {
    const frame = composedFrame(SOURCES.gem);
    const html = composedFrameHtml("data:image/png;base64,AAAA", frame, "rgb(248, 250, 252)");
    expect(html).toContain("background: rgb(248, 250, 252)");
    expect(html).toContain(`width: ${frame.stage.width}px; height: ${frame.stage.height}px`);
    expect(html).toContain(`left: ${frame.offset.x}px; top: ${frame.offset.y}px`);
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain("overflow: hidden");
  });
});

describe("PNG sizing", () => {
  it("reads IHDR instead of trusting a bounding box", () => {
    const png = new Uint8Array(24);
    const view = new DataView(png.buffer);
    view.setUint32(16, 1200);
    view.setUint32(20, 733);
    expect(pngSize(png)).toEqual({ width: 1200, height: 733 });
  });

  it("refuses a buffer too short to hold a header", () => {
    expect(() => pngSize(new Uint8Array(8))).toThrow(/PNG/);
  });
});

describe("the clean stage", () => {
  it("hides both assistants and the transient overlays by default", () => {
    const css = cleanStageCss(".schedule-list");
    for (const selector of [
      ".concierge-fab",
      ".concierge-panel",
      ".copilot-fab",
      ".copilot-panel",
    ]) {
      expect(css).toContain(selector);
    }
    expect(css).toContain("display: none !important");
    // Hiding a docked panel without releasing its gutter would leave a band of
    // background where the panel was.
    for (const bodyClass of DOCKED_BODY_CLASSES) {
      expect(css).toContain(`body.${bodyClass} .shell-content { margin-right: 0 !important; }`);
    }
  });

  it("keeps the surface a shot is actually photographing", () => {
    const css = cleanStageCss(SCREENSHOT_MANIFEST.concierge!.selector);
    expect(stageHideSelectors(".concierge-panel")).not.toContain(".concierge-panel");
    expect(stageHideSelectors(".concierge-panel")).not.toContain(".concierge-fab");
    expect(css).not.toContain(".concierge-panel");
    expect(css).not.toContain("concierge-docked");
    // The organizer dock is still someone else's chrome, so it still goes.
    expect(css).toContain(".copilot-panel");
  });

  it("clears the assistant open-state keys that leaked between shots", () => {
    expect(isAssistantOpenStorageKey("conciergeOpen")).toBe(true);
    expect(isAssistantOpenStorageKey("copilotOpen:evt_123")).toBe(true);
    expect(isAssistantOpenStorageKey("copilotDockEventId")).toBe(true);
    expect(isAssistantOpenStorageKey("activeEventId")).toBe(false);
    expect(isAssistantOpenStorageKey("theme")).toBe(false);
  });
});

describe("page scope", () => {
  it("clips the page for the two selectors that mean the page", () => {
    expect(PAGE_SCOPE_SELECTORS).toEqual([".kit-page-stack", "main.page"]);
    for (const selector of PAGE_SCOPE_SELECTORS) expect(isPageScopeSelector(selector)).toBe(true);
    expect(PAGE_SCOPE_TOP_PAD).toBeGreaterThan(0);
  });

  it("photographs every other manifest selector as an element", () => {
    const pageScoped = Object.entries(SCREENSHOT_MANIFEST)
      .filter(([, shot]) => isPageScopeSelector(shot.selector))
      .map(([key]) => key);
    expect(pageScoped.sort()).toEqual(["cfp", "community", "community_icebreakers"]);
  });
});
