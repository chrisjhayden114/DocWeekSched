/**
 * SHOT-CI.6 — the frame math is what stops a capture run from filing a 250px
 * gem badge and a 2000px console tab as the same kind of picture, and what
 * stops a narrow subject from arriving as a speck on a wide white canvas. It
 * runs inside a browser during a capture, so these tests pin it without one.
 */

import { describe, expect, it } from "vitest";
import {
  ALIGN_TOP_PAD,
  CAPTURE_DEVICE_SCALE,
  DOCKED_BODY_CLASSES,
  FRAME_CONTENT_HEIGHT,
  FRAME_CONTENT_WIDTH,
  FRAME_FILL_TARGET,
  FRAME_MAX_PIXEL_UPSCALE,
  FRAME_PAD,
  PAGE_SCOPE_SELECTORS,
  PAGE_SCOPE_TOP_PAD,
  cleanStageCss,
  composedFrame,
  composedFrameHtml,
  describeFrame,
  isAssistantOpenStorageKey,
  isPageScopeSelector,
  magnifyCss,
  maxFrameUpscale,
  pngSize,
  stageHideSelectors,
  subjectTopClip,
  topAlignedClip,
} from "../screenshot-frame";
import {
  SCREENSHOT_CARD_HEIGHT,
  SCREENSHOT_MANIFEST,
  SCREENSHOT_MAX_HEIGHT,
  SCREENSHOT_MIN_HEIGHT,
  SCREENSHOT_WIDTH,
  isPageShot,
} from "../screenshot-manifest";

const DPR = CAPTURE_DEVICE_SCALE;

/** A CSS-pixel size as it arrives from a retina capture. */
function retina(css: { width: number; height: number }) {
  return { width: css.width * DPR, height: css.height * DPR };
}

/**
 * Real subject sizes in CSS pixels, roughly as the surfaces they name measure
 * at 1440px. Every one of them reaches the frame step as `retina(...)`.
 */
const SUBJECTS = {
  /** The engagement pill, unmagnified: too small for any amount of scaling. */
  gem: { width: 62, height: 23 },
  /** The same pill after the manifest's `magnify`. */
  magnifiedGem: { width: 62 * 8, height: 23 * 8 },
  /** The docked concierge panel, clipped to its chrome. */
  panel: { width: 384, height: 420 },
  /** The agenda filter rail — the toggle the founder called a postage stamp. */
  toggle: { width: 720, height: 108 },
  /** The floor plan canvas. */
  map: { width: 720, height: 520 },
  card: { width: 992, height: 320 },
  tallCard: { width: 992, height: 2140 },
  wide: { width: 1392, height: 512 },
  pageClip: { width: SCREENSHOT_WIDTH, height: SCREENSHOT_MAX_HEIGHT },
  cardShapedClip: { width: SCREENSHOT_WIDTH, height: SCREENSHOT_CARD_HEIGHT },
};

describe("composed frames are always card-shaped", () => {
  it("puts every input on a 1200-wide stage between 380 and 760 tall", () => {
    for (const [name, css] of Object.entries(SUBJECTS)) {
      const { stage } = composedFrame(retina(css), { dpr: DPR });
      expect(stage.width, name).toBe(SCREENSHOT_WIDTH);
      expect(stage.height, name).toBeGreaterThanOrEqual(SCREENSHOT_MIN_HEIGHT);
      expect(stage.height, name).toBeLessThanOrEqual(SCREENSHOT_MAX_HEIGHT);
      expect(Number.isInteger(stage.height), name).toBe(true);
    }
  });

  it("never lets the image hang off the left or the right of the stage", () => {
    for (const [name, css] of Object.entries(SUBJECTS)) {
      const { stage, image, offset } = composedFrame(retina(css), { dpr: DPR });
      expect(offset.x, name).toBeGreaterThanOrEqual(0);
      expect(offset.x + image.width, name).toBeLessThanOrEqual(stage.width);
      expect(image.width, name).toBeGreaterThan(0);
      expect(image.height, name).toBeGreaterThan(0);
    }
  });

  it("keeps the subject's aspect ratio, so nothing is stretched", () => {
    for (const [name, css] of Object.entries(SUBJECTS)) {
      const { image } = composedFrame(retina(css), { dpr: DPR });
      const before = css.width / css.height;
      const after = image.width / image.height;
      expect(Math.abs(after - before), name).toBeLessThan(0.02 * before);
    }
  });
});

describe("the fill rule", () => {
  it("fills at least the target share of the width for anything the cap can reach", () => {
    // Below this a subject cannot be filled out on pixels alone and asks for
    // `magnify` instead; everything at or above it fills the width unless its
    // own height hits the frame's ceiling first.
    const reachable = FRAME_CONTENT_WIDTH / maxFrameUpscale(DPR);
    for (const [name, css] of Object.entries(SUBJECTS)) {
      if (css.width < reachable) continue;
      const { fill, image } = composedFrame(retina(css), { dpr: DPR });
      const heightBound = image.height >= FRAME_CONTENT_HEIGHT;
      expect(
        fill >= FRAME_FILL_TARGET || heightBound,
        `${name} should fill the frame (filled ${Math.round(fill * 100)}%)`,
      ).toBe(true);
    }
  });

  it("enlarges a narrow rail into the gutters instead of centering it at its own size", () => {
    const { image, stage, offset, cropTop, scale } = composedFrame(retina(SUBJECTS.toggle), {
      dpr: DPR,
    });
    expect(image.width).toBe(FRAME_CONTENT_WIDTH);
    expect(scale).toBeGreaterThan(1);
    expect(offset.x).toBe(FRAME_PAD);
    expect(cropTop).toBe(false);
    // Even gutters, and the frame hugs the subject rather than the 760 ceiling.
    expect(stage.width - (offset.x + image.width)).toBe(offset.x);
    expect(stage.height).toBe(SCREENSHOT_MIN_HEIGHT);
  });

  it("enlarges a portrait panel until its height runs out, not its width", () => {
    const { image, stage, cropTop } = composedFrame(retina(SUBJECTS.panel), { dpr: DPR });
    expect(image.height).toBe(FRAME_CONTENT_HEIGHT);
    expect(image.width).toBeLessThan(FRAME_CONTENT_WIDTH);
    expect(stage.height).toBe(SCREENSHOT_MAX_HEIGHT);
    // A subject that fits is never cropped, whatever shape it is.
    expect(cropTop).toBe(false);
  });

  it("never stretches a capture past its own pixels by more than the sharpness cap", () => {
    expect(maxFrameUpscale(DPR)).toBeCloseTo(2.2, 5);
    for (const [name, css] of Object.entries(SUBJECTS)) {
      const source = retina(css);
      const { image } = composedFrame(source, { dpr: DPR });
      expect(image.width / source.width, `${name} pixel upscale`).toBeLessThanOrEqual(
        FRAME_MAX_PIXEL_UPSCALE + 0.001,
      );
    }
  });

  it("would rather leave gutters than stretch a narrow, very long subject 3x", () => {
    const { image, cropTop } = composedFrame(retina({ width: 380, height: 1600 }), { dpr: DPR });
    expect(image.width).toBeLessThan(SCREENSHOT_WIDTH);
    expect(image.width / (380 * DPR)).toBeLessThanOrEqual(FRAME_MAX_PIXEL_UPSCALE + 0.001);
    expect(cropTop).toBe(true);
  });

  it("scales the cap with the capture's DPR rather than hard-coding 2.2x", () => {
    expect(maxFrameUpscale(1)).toBeCloseTo(FRAME_MAX_PIXEL_UPSCALE, 5);
    expect(maxFrameUpscale(4)).toBeCloseTo(FRAME_MAX_PIXEL_UPSCALE * 4, 5);
    const cheap = composedFrame(SUBJECTS.gem, { dpr: 1 });
    const retinaGem = composedFrame(retina(SUBJECTS.gem), { dpr: DPR });
    expect(retinaGem.scale).toBeGreaterThan(cheap.scale);
  });

  it("still cannot fill a 62px pill, which is why that shot magnifies first", () => {
    const asIs = composedFrame(retina(SUBJECTS.gem), { dpr: DPR });
    expect(asIs.fill).toBeLessThan(FRAME_FILL_TARGET);
    // Magnified at the factor the manifest asks for, the same pill clears the
    // fill target — which is the whole reason that factor is 8 and not 4.
    const magnified = composedFrame(retina(SUBJECTS.magnifiedGem), { dpr: DPR });
    expect(magnified.fill).toBeGreaterThanOrEqual(FRAME_FILL_TARGET);
    expect(magnified.image.width).toBeGreaterThan(asIs.image.width * 3);
  });
});

describe("subjects bigger than the frame", () => {
  it("takes an over-wide shot edge to edge instead of leaving gutters", () => {
    const { image, offset, cropTop } = composedFrame(retina(SUBJECTS.wide), { dpr: DPR });
    expect(image.width).toBe(SCREENSHOT_WIDTH);
    expect(offset.x).toBe(0);
    expect(cropTop).toBe(false);
  });

  it("shows the top of a long surface rather than shrinking it to a poster", () => {
    const { stage, image, offset, cropTop } = composedFrame(retina(SUBJECTS.tallCard), {
      dpr: DPR,
    });
    expect(image.width).toBe(SCREENSHOT_WIDTH);
    expect(stage.height).toBe(SCREENSHOT_MAX_HEIGHT);
    expect(cropTop).toBe(true);
    expect(offset.y).toBe(0);
  });

  it("passes a full-width page clip through at its own scale", () => {
    const { stage, image, offset } = composedFrame(retina(SUBJECTS.pageClip), { dpr: DPR });
    expect(image).toEqual(SUBJECTS.pageClip);
    expect(stage.height).toBe(SCREENSHOT_MAX_HEIGHT);
    expect(offset).toEqual({ x: 0, y: 0 });
  });

  it("keeps a card-shaped clip at exactly the card's aspect ratio", () => {
    const { stage, image } = composedFrame(retina(SUBJECTS.cardShapedClip), { dpr: DPR });
    expect(stage).toEqual({ width: SCREENSHOT_WIDTH, height: SCREENSHOT_CARD_HEIGHT });
    expect(image).toEqual(SUBJECTS.cardShapedClip);
  });

  it("treats a 150dpi PDF page as the inches it is, and fills the width", () => {
    // LETTER at 150dpi. CSS inches are 96dpi, so the page is 816 CSS px wide.
    const frame = composedFrame({ width: 1275, height: 1650 }, { dpr: 150 / 96 });
    expect(frame.image.width).toBe(SCREENSHOT_WIDTH);
    expect(frame.stage.height).toBe(SCREENSHOT_MAX_HEIGHT);
    expect(frame.cropTop).toBe(true);
    // Downsampled from the render, so the type stays sharp.
    expect(frame.image.width / 1275).toBeLessThan(1);
  });
});

describe("the composed stage document", () => {
  it("positions the image and paints the gutters the surface's own colour", () => {
    const frame = composedFrame(retina(SUBJECTS.toggle), { dpr: DPR });
    const html = composedFrameHtml("data:image/png;base64,AAAA", frame, "rgb(248, 250, 252)");
    expect(html).toContain("background: rgb(248, 250, 252)");
    expect(html).toContain(`width: ${frame.stage.width}px; height: ${frame.stage.height}px`);
    expect(html).toContain(`left: ${frame.offset.x}px; top: ${frame.offset.y}px`);
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain("overflow: hidden");
  });

  it("logs the dimensions a reviewer would otherwise have to download to see", () => {
    const line = describeFrame(composedFrame(retina(SUBJECTS.toggle), { dpr: DPR }));
    expect(line).toContain(`${SCREENSHOT_WIDTH}x${SCREENSHOT_MIN_HEIGHT}`);
    expect(line).toContain("% fill");
    expect(describeFrame(composedFrame(retina(SUBJECTS.tallCard), { dpr: DPR }))).toContain(
      "top-cropped",
    );
  });
});

describe("magnification", () => {
  it("scales the subject from its own centre and touches nothing else", () => {
    const css = magnifyCss(".points-gem", 6);
    expect(css).toContain(".points-gem {");
    expect(css).toContain("transform: scale(6)");
    expect(css).toContain("transform-origin: center center");
    // Geometry only: no colour, size, or state is invented.
    expect(css).not.toMatch(/color|background|font|opacity/);
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
    const concierge = SCREENSHOT_MANIFEST.concierge!;
    expect(isPageShot(concierge)).toBe(true);
    const css = cleanStageCss(isPageShot(concierge) ? concierge.selector : "");
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
    expect(ALIGN_TOP_PAD).toBe(PAGE_SCOPE_TOP_PAD);
  });

  it("photographs every other manifest selector as an element", () => {
    const pageScoped = Object.entries(SCREENSHOT_MANIFEST)
      .filter(([, shot]) => isPageShot(shot) && isPageScopeSelector(shot.selector))
      .map(([key]) => key);
    expect(pageScoped.sort()).toEqual(["cfp", "community", "community_icebreakers"]);
  });
});

describe("top-aligned clips", () => {
  it("pins the frame to the subject's top plus pad, not mid-row", () => {
    const clip = topAlignedClip(
      { x: 80, y: 240, width: 1040, height: 1800 },
      { width: 1440, height: 2200 },
    );
    expect(clip.y).toBe(240 - ALIGN_TOP_PAD);
    expect(clip.height).toBe(SCREENSHOT_MAX_HEIGHT);
    expect(clip.width).toBe(SCREENSHOT_WIDTH);
  });

  it("takes clipHeight as the whole clip, so a card-shaped frame is exact", () => {
    const clip = topAlignedClip(
      { x: 400, y: 96, width: 640, height: 1800 },
      { width: 1440, height: 2200 },
      { clipHeight: SCREENSHOT_CARD_HEIGHT },
    );
    expect(clip.height).toBe(SCREENSHOT_CARD_HEIGHT);
    expect(clip.y).toBe(96 - ALIGN_TOP_PAD);
  });

  it("clips a docked panel to its own top edge and width", () => {
    const clip = subjectTopClip({ x: 1056, y: 64, width: 384, height: 1036 }, 420);
    expect(clip).toEqual({ x: 1056, y: 64, width: 384, height: 420 });
  });
});
