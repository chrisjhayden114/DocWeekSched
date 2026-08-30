/**
 * SHOT-CI.3 — the stage rules and frame geometry a capture run applies around
 * each Playwright screenshot.
 *
 * Everything here is pure so `__tests__/screenshotFrame.test.ts` can pin the
 * math without a browser: the script drives the page, this file decides what
 * the resulting image should look like.
 *
 * Two problems live here:
 *
 *  1. A floating FAB or a docked assistant panel used to drift over a clip. The
 *     hide rules below take that chrome off the stage before every shot, and
 *     skip the family a shot is deliberately photographing.
 *  2. Element screenshots come out at whatever size the element is, but the
 *     Feature Guide hover cards crop a fixed art slot. `composedFrame` says how
 *     to re-stage such an image on a uniform 1200-wide canvas.
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

export function isPageScopeSelector(selector: string): boolean {
  return (PAGE_SCOPE_SELECTORS as readonly string[]).includes(selector.trim());
}

/**
 * Enlarge a small shot only once it would otherwise float in a sea of
 * background — below this the frame is better off with quiet gutters than with
 * a resampled screenshot.
 */
export const FRAME_UPSCALE_THRESHOLD = 2;

/** And never past this: beyond 3x a 1x PNG stops reading as a screenshot. */
export const FRAME_MAX_UPSCALE = 3;

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
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Whether an image is already a legal frame and can be written straight out. */
export function needsComposedFrame(source: Size): boolean {
  return (
    Math.round(source.width) !== SCREENSHOT_WIDTH ||
    source.height < SCREENSHOT_MIN_HEIGHT ||
    source.height > SCREENSHOT_MAX_HEIGHT
  );
}

/**
 * How to re-stage `source` as a card-friendly frame. The result is always
 * SCREENSHOT_WIDTH wide and between SCREENSHOT_MIN_HEIGHT and
 * SCREENSHOT_MAX_HEIGHT tall, whatever came in.
 */
export function composedFrame(source: Size): ComposedFrame {
  const width = Math.max(1, Math.round(source.width));
  const height = Math.max(1, Math.round(source.height));

  const stage: Size = {
    width: SCREENSHOT_WIDTH,
    height: Math.round(clamp(height, SCREENSHOT_MIN_HEIGHT, SCREENSHOT_MAX_HEIGHT)),
  };

  const fit = Math.min(stage.width / width, stage.height / height);
  // Over-wide images have to shrink to the frame; tall ones keep their scale
  // and get cropped instead.
  const scale =
    fit >= FRAME_UPSCALE_THRESHOLD
      ? Math.min(fit, FRAME_MAX_UPSCALE)
      : Math.min(1, stage.width / width);

  const image: Size = {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
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
  };
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
