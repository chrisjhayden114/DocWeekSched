/**
 * SHOT-CI.6 — the stage rules and frame geometry a capture run applies around
 * each Playwright screenshot.
 *
 * Everything here is pure so `__tests__/screenshotFrame.test.ts` can pin the
 * math without a browser: the script drives the page, this file decides what
 * the resulting image should look like.
 *
 * Three problems live here:
 *
 *  1. A floating FAB or a docked assistant panel used to drift over a clip. The
 *     hide rules below take that chrome off the stage before every shot, and
 *     skip the family a shot is deliberately photographing.
 *  2. Element screenshots come out at whatever size the element is, but the
 *     Feature Guide hover cards crop a fixed art slot. `composedFrame` says how
 *     to re-stage such an image on a uniform 1200-wide canvas.
 *  3. A narrow subject used to be centred at roughly its own size, which read
 *     as a postage stamp on a sea of background. `composedFrame` now FILLS the
 *     frame: it scales the subject up to the gutters, and the sharpness cap
 *     that stops it turning to mush is a function of how many real pixels the
 *     capture holds — which is why captures run at CAPTURE_DEVICE_SCALE.
 */

import {
  SCREENSHOT_MAX_HEIGHT,
  SCREENSHOT_MIN_HEIGHT,
  SCREENSHOT_WIDTH,
} from "./screenshot-manifest";

export type Size = { width: number; height: number };

/**
 * Selectors that mean "the whole page". For these a document clip is the
 * honest shot — the element is the content column, and photographing it
 * exactly would crop off the surrounding page. Everything else is scoped to a
 * component and gets a true element screenshot.
 */
export const PAGE_SCOPE_SELECTORS = [".kit-page-stack", "main.page"] as const;

/** Breathing room above a page-scope clip so the first heading isn't flush-cut. */
export const PAGE_SCOPE_TOP_PAD = 16;

/**
 * Same pad for console-tab / align-top clips: the first heading should sit
 * just below the top of the frame, not flush-cut and not mid-row.
 */
export const ALIGN_TOP_PAD = PAGE_SCOPE_TOP_PAD;

export function isPageScopeSelector(selector: string): boolean {
  return (PAGE_SCOPE_SELECTORS as readonly string[]).includes(selector.trim());
}

export type DocumentBox = { x: number; y: number; width: number; height: number };
export type DocumentSize = { width: number; height: number };

/**
 * A document clip pinned to the top of `box`, with optional pad above and an
 * optional height cap. Used for page-scope shots and console tabs that must
 * open on their first heading rather than mid-row.
 *
 * `clipHeight` is the height of the whole clip, pad included — a shot that asks
 * for SCREENSHOT_CARD_HEIGHT wants exactly that many pixels of page, so that
 * the hover card's crop cannot eat the heading it was aimed at.
 */
export function topAlignedClip(
  box: DocumentBox,
  doc: DocumentSize,
  opts: { pad?: number; maxHeight?: number; minHeight?: number; clipHeight?: number } = {},
): DocumentBox {
  const pad = opts.pad ?? ALIGN_TOP_PAD;
  const maxHeight = opts.maxHeight ?? SCREENSHOT_MAX_HEIGHT;
  const minHeight = opts.minHeight ?? SCREENSHOT_MIN_HEIGHT;
  const width = Math.min(SCREENSHOT_WIDTH, Math.max(1, Math.round(doc.width)));
  const rawHeight = opts.clipHeight ?? box.height + pad;
  const height = Math.round(Math.min(maxHeight, Math.max(minHeight, rawHeight)));
  const centered = Math.round(box.x + box.width / 2 - width / 2);
  const x = Math.max(0, Math.min(centered, Math.max(0, doc.width - width)));
  const y = Math.max(0, Math.min(box.y - pad, Math.max(0, doc.height - height)));
  return { x, y, width, height };
}

/**
 * Tight clip of a component's own top edge — used when a docked panel is
 * taller than the interesting chrome (header + chips + input).
 */
export function subjectTopClip(box: DocumentBox, clipHeight: number): DocumentBox {
  const height = Math.max(1, Math.round(Math.min(clipHeight, box.height)));
  return {
    x: Math.max(0, Math.round(box.x)),
    y: Math.max(0, Math.round(box.y)),
    width: Math.max(1, Math.round(box.width)),
    height,
  };
}

/** Union of one or more boxes — the painted bounds of an element and its children. */
export function unionBoxes(boxes: readonly DocumentBox[]): DocumentBox {
  if (boxes.length === 0) return { x: 0, y: 0, width: 1, height: 1 };
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const box of boxes) {
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.width);
    bottom = Math.max(bottom, box.y + box.height);
  }
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

/** Grow a clip by `pad` CSS pixels on every side, clamped to the document. */
export function padClip(box: DocumentBox, pad: number, doc?: DocumentSize): DocumentBox {
  const grown: DocumentBox = {
    x: box.x - pad,
    y: box.y - pad,
    width: box.width + 2 * pad,
    height: box.height + 2 * pad,
  };
  if (!doc) {
    return {
      x: Math.max(0, Math.round(grown.x)),
      y: Math.max(0, Math.round(grown.y)),
      width: Math.max(1, Math.round(grown.width)),
      height: Math.max(1, Math.round(grown.height)),
    };
  }
  const x = Math.max(0, Math.round(grown.x));
  const y = Math.max(0, Math.round(grown.y));
  const right = Math.min(doc.width, Math.round(grown.x + grown.width));
  const bottom = Math.min(doc.height, Math.round(grown.y + grown.height));
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
}

/**
 * Every capture context runs at this device pixel ratio, so a source PNG holds
 * twice the pixels of the CSS box it photographed. That is what buys the frame
 * step room to enlarge a narrow subject without resampling it into mush.
 */
export const CAPTURE_DEVICE_SCALE = 2;

/**
 * How far the frame step may stretch a source past its own pixels. Sharpness,
 * not size, is the constraint here: at CAPTURE_DEVICE_SCALE = 2 this works out
 * to 2.2x the subject's CSS size, and it scales with the capture's DPR rather
 * than being a magic number that silently lies when the DPR changes.
 */
export const FRAME_MAX_PIXEL_UPSCALE = 1.1;

/** The largest CSS magnification a frame may apply to a `dpr`-scaled capture. */
export function maxFrameUpscale(dpr: number = CAPTURE_DEVICE_SCALE): number {
  return FRAME_MAX_PIXEL_UPSCALE * Math.max(1, dpr);
}

/**
 * Modest even gutters. They exist for one reason: the hover card crops the art
 * slot with `object-fit: cover` + `object-position: left top`, which shaves a
 * few percent off the right and bottom, and a subject pushed flush to the
 * frame edge would lose its own border to that.
 */
export const FRAME_PAD = 28;

/** The box a padded subject is scaled into. */
export const FRAME_CONTENT_WIDTH = SCREENSHOT_WIDTH - 2 * FRAME_PAD;
export const FRAME_CONTENT_HEIGHT = SCREENSHOT_MAX_HEIGHT - 2 * FRAME_PAD;

/**
 * The share of the frame width a composed subject should occupy. Anything wider
 * than FRAME_CONTENT_WIDTH / maxFrameUpscale() reaches it; a genuinely tiny
 * control cannot, and asks for `magnify` instead of being quietly resampled.
 */
export const FRAME_FILL_TARGET = 0.85;

export type ComposedFrame = {
  /** The canvas to screenshot: always SCREENSHOT_WIDTH by a legal height. */
  stage: Size;
  /** The source PNG, scaled to sit on that canvas. */
  image: Size;
  /** Where the image goes on the canvas. */
  offset: { x: number; y: number };
  /**
   * The image is taller than the frame, so it is pinned to the top and the
   * overflow is clipped. A tall surface shrunk to fit becomes an illegible
   * poster, and its top is the part that says what the surface is.
   */
  cropTop: boolean;
  /** CSS magnification applied to the subject, for the capture log. */
  scale: number;
  /** Share of the frame width the subject ended up occupying, 0–1. */
  fill: number;
};

export type ComposeOptions = {
  /**
   * Device pixel ratio the source PNG was captured at. The frame reasons in CSS
   * pixels, so this is how it knows a 2400px-wide PNG is a 1200px surface with
   * pixels to spare rather than an enormous one.
   */
  dpr?: number;
  /**
   * Skip the 380px floor so a short card is not padded with dead white.
   * Width stays SCREENSHOT_WIDTH; height hugs the subject plus gutters.
   */
  hug?: boolean;
};

/** Amber box the capture script paints around a `highlight` selector. */
export const SHOT_HIGHLIGHT_COLOR = "#c9920a";

export function highlightCss(selector: string): string {
  return [
    `${selector} {`,
    `  outline: 3px solid var(--decision-amber, ${SHOT_HIGHLIGHT_COLOR}) !important;`,
    "  outline-offset: 4px !important;",
    "  border-radius: var(--radius-sm, 4px);",
    "  box-shadow: 0 0 0 6px #ffffff !important;",
    "}",
  ].join("\n");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * How to re-stage `source` as a card-friendly frame. The result is always
 * SCREENSHOT_WIDTH wide and between SCREENSHOT_MIN_HEIGHT and
 * SCREENSHOT_MAX_HEIGHT tall, whatever came in.
 *
 * The subject always fills the frame as far as it is allowed to:
 *  - smaller than the frame → scaled up into the gutters, capped by
 *    maxFrameUpscale(dpr) so the result stays sharp;
 *  - bigger than the frame → scaled down to the full frame width, edge to edge,
 *    with any overflow cropped off the bottom rather than shrunk to a poster.
 */
export function composedFrame(source: Size, opts: ComposeOptions = {}): ComposedFrame {
  const dpr = Math.max(1, opts.dpr ?? 1);
  const cssWidth = Math.max(1, source.width / dpr);
  const cssHeight = Math.max(1, source.height / dpr);

  const fit = Math.min(FRAME_CONTENT_WIDTH / cssWidth, FRAME_CONTENT_HEIGHT / cssHeight);
  // A subject that fits inside the gutters gets enlarged into them; one that
  // does not gives up its gutters and goes edge to edge.
  const padded = fit >= 1;
  // The cap applies either way. It only ever binds on something narrow and very
  // long, where filling the width would mean a 3x stretch of the type as well.
  const scale = Math.min(padded ? fit : SCREENSHOT_WIDTH / cssWidth, maxFrameUpscale(dpr));

  const image: Size = {
    width: Math.max(1, Math.round(cssWidth * scale)),
    height: Math.max(1, Math.round(cssHeight * scale)),
  };
  const stage: Size = {
    width: SCREENSHOT_WIDTH,
    height: Math.round(
      clamp(
        image.height + (padded ? 2 * FRAME_PAD : 0),
        opts.hug ? 1 : SCREENSHOT_MIN_HEIGHT,
        SCREENSHOT_MAX_HEIGHT,
      ),
    ),
  };
  const cropTop = image.height > stage.height;

  return {
    stage,
    image,
    offset: {
      x: Math.round((stage.width - image.width) / 2),
      y: cropTop ? 0 : Math.round((stage.height - image.height) / 2),
    },
    cropTop,
    scale,
    fill: image.width / stage.width,
  };
}

/** One log line per shot, so a size regression is visible in the CI output. */
export function describeFrame(frame: ComposedFrame): string {
  const percent = Math.round(frame.fill * 100);
  const crop = frame.cropTop ? ", top-cropped" : "";
  return (
    `${frame.stage.width}x${frame.stage.height} ` +
    `(subject ${frame.image.width}x${frame.image.height} at ${frame.scale.toFixed(2)}x, ${percent}% fill${crop})`
  );
}

/** The document a compose stage renders: one image, centered, on the page's own background. */
export function composedFrameHtml(
  imageSrc: string,
  frame: ComposedFrame,
  background: string,
): string {
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8"><style>',
    `html, body { margin: 0; padding: 0; overflow: hidden; background: ${background}; }`,
    `body { width: ${frame.stage.width}px; height: ${frame.stage.height}px; position: relative; }`,
    `img.shot { position: absolute; left: ${frame.offset.x}px; top: ${frame.offset.y}px;`,
    ` width: ${frame.image.width}px; height: ${frame.image.height}px; }`,
    "</style></head><body>",
    `<img class="shot" src="${imageSrc}" alt="">`,
    "</body></html>",
  ].join("");
}

/**
 * Render a subject at `factor` times its layout size before photographing it.
 *
 * A CSS transform, not a resample: Chromium paints the scaled element from the
 * same vector geometry, so a 60px pill comes back as a crisp 400px one. The
 * fill rule then treats that as the subject's real size. Nothing about the
 * component's own styling changes, which is the difference between magnifying a
 * control and faking one.
 */
export function magnifyCss(selector: string, factor: number): string {
  return `${selector} { transform: scale(${factor}) !important; transform-origin: center center !important; }`;
}

/** PNG dimensions from the IHDR header — exact, where a bounding box rounds. */
export function pngSize(png: Uint8Array): Size {
  if (png.length < 24) throw new Error("not a PNG: fewer than 24 bytes");
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** The attendee assistant: launcher, docked panel, and its mobile sheet. */
const ATTENDEE_ASSISTANT_CHROME = [
  ".concierge-fab",
  ".concierge-panel",
  ".concierge-sheet",
  ".concierge-sheet-backdrop",
];

/** The organizer setup assistant dock, same shape under a different prefix. */
const ORGANIZER_ASSISTANT_CHROME = [
  ".copilot-fab",
  ".copilot-panel",
  ".copilot-sheet",
  ".copilot-sheet-backdrop",
];

/**
 * Fixed overlays that belong to an interaction, not to a surface. None of them
 * should be open when a shot is taken, but a stray hover or a menu left open by
 * a click step would otherwise land in the frame. The app has no toast
 * component today; the toast selectors keep a future one off the stage.
 */
const TRANSIENT_OVERLAYS = [
  ".hover-info-popover",
  ".select-popup",
  ".kebab-panel",
  ".console-tabstrip-more-panel",
  ".modal-backdrop",
  ".drawer-panel",
  ".drawer-backdrop",
  ".agenda-add-modal-overlay",
  ".session-peek-backdrop",
  ".shell-sheet-backdrop",
  ".kit-lightbox-overlay",
  ".toast",
  "[data-toast]",
];

type ChromeFamily = {
  selectors: string[];
  /**
   * Class the family puts on <body> while docked, which reserves a gutter in
   * .shell-content. Hiding the panel without releasing the gutter would leave
   * a 384px band of background in the shot.
   */
  dockedBodyClass?: string;
};

const CHROME_FAMILIES: ChromeFamily[] = [
  { selectors: ATTENDEE_ASSISTANT_CHROME, dockedBodyClass: "concierge-docked" },
  { selectors: ORGANIZER_ASSISTANT_CHROME, dockedBodyClass: "copilot-docked" },
  { selectors: TRANSIENT_OVERLAYS },
];

/** Body classes a run clears between shots, so a docked panel cannot leak forward. */
export const DOCKED_BODY_CLASSES = CHROME_FAMILIES.flatMap((family) =>
  family.dockedBodyClass ? [family.dockedBodyClass] : [],
);

/**
 * Storage keys the two assistants restore their open state from. The concierge
 * shot opens the panel by clicking it, and without clearing these the panel
 * came back on every later shot in the same context — those stray chat
 * fragments down the right edge of the attendee captures.
 */
export const ASSISTANT_OPEN_STORAGE_PREFIXES = [
  "conciergeOpen",
  "copilotOpen",
  "copilotDockEventId",
];

export function isAssistantOpenStorageKey(key: string): boolean {
  return ASSISTANT_OPEN_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function ownsSelector(family: ChromeFamily, shotSelector: string): boolean {
  return family.selectors.some((selector) => shotSelector.includes(selector));
}

/** Floating chrome to hide for a shot of `shotSelector` — its own family stays. */
export function stageHideSelectors(shotSelector: string): string[] {
  return CHROME_FAMILIES.filter((family) => !ownsSelector(family, shotSelector)).flatMap(
    (family) => family.selectors,
  );
}

/**
 * A stylesheet that clears the stage for a shot of `shotSelector`. The shot's
 * own surface is never hidden: the concierge card is a picture of the panel, so
 * that shot keeps its panel and only loses everything else.
 */
export function cleanStageCss(shotSelector: string): string {
  const rules: string[] = [];
  for (const family of CHROME_FAMILIES) {
    if (ownsSelector(family, shotSelector)) continue;
    rules.push(`${family.selectors.join(",\n")} { display: none !important; }`);
    if (family.dockedBodyClass) {
      rules.push(`body.${family.dockedBodyClass} .shell-content { margin-right: 0 !important; }`);
    }
  }
  return rules.join("\n\n");
}
