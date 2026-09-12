/**
 * AGENDA-1 — placement rules for the session peek popover. It sits *beside* its
 * card (sched.com), so the interesting cases are which side wins, when neither
 * does, and where the caret ends up once the vertical position is clamped.
 */

import { describe, expect, it } from "vitest";
import { anchorBeside, type AnchorRect } from "../lib/popupAnchor";
import { PEEK_POPOVER_WIDTH, peekPopoverMaxHeight } from "../components/SessionPeekPopover";
import { PEEK_POPOVER_MIN_WIDTH, peekSurfaceFor } from "../lib/sessionPeekSurface";

const viewport = { width: 1440, height: 900 };
const opts = { width: PEEK_POPOVER_WIDTH, maxHeight: 560 };

/** A 600px-wide agenda card, 80px tall, at (left, top). */
const card = (top: number, left = 200, width = 600): AnchorRect => ({
  top,
  bottom: top + 80,
  left,
  right: left + width,
  width,
});

describe("side selection", () => {
  it("prefers the right of the card when there is room", () => {
    const { placement, style } = anchorBeside(card(300), viewport, opts);
    expect(placement).toBe("right");
    // 200 + 600 = 800 right edge, + 10px gap.
    expect(style.left).toBe(810);
    expect(style.right).toBeUndefined();
    expect(style.width).toBe(PEEK_POPOVER_WIDTH);
  });

  it("flips to the left near the viewport's right edge", () => {
    // Card's right edge at 1400 leaves 30px — nowhere near 420.
    const { placement, style } = anchorBeside(card(300, 800), viewport, opts);
    expect(placement).toBe("left");
    expect(style.right).toBe(viewport.width - 800 + 10);
    expect(style.left).toBeUndefined();
  });

  it("falls back to below the card when neither side fits", () => {
    const narrow = { width: 900, height: 900 };
    // A full-width card: 40px free on the right, 40px on the left.
    const { placement, style } = anchorBeside(card(200, 40, 820), narrow, opts);
    expect(placement).toBe("below");
    expect(style.top).toBe(290);
    // No caret to draw when the popover is not beside anything.
    expect(anchorBeside(card(200, 40, 820), narrow, opts).caretTop).toBeUndefined();
  });

  it("flips above when it cannot go beside and there is no room below", () => {
    const narrow = { width: 900, height: 900 };
    const { placement } = anchorBeside(card(800, 40, 820), narrow, opts);
    expect(placement).toBe("above");
  });
});

describe("vertical placement and the caret", () => {
  it("centres on the card and points the caret at its middle", () => {
    const { style, caretTop } = anchorBeside(card(300), viewport, opts);
    const cardMid = 340;
    expect(style.top).toBe(cardMid - 560 / 2);
    // Centred, so the caret sits at the popover's own midpoint.
    expect(caretTop).toBe(280);
  });

  it("clamps to the viewport top and moves the caret to follow the card", () => {
    const { style, caretTop } = anchorBeside(card(20), viewport, opts);
    expect(style.top).toBe(8);
    // Card middle is 60px down the page, i.e. 52px below the popover's top.
    expect(caretTop).toBe(52);
  });

  it("clamps to the viewport bottom", () => {
    const { style } = anchorBeside(card(860), viewport, opts);
    expect(style.top).toBe(viewport.height - 8 - 560);
  });

  it("keeps the caret off the popover's rounded corners", () => {
    // A card at the very top of the page would otherwise put the caret at 0.
    const { caretTop } = anchorBeside({ top: -40, bottom: 0, left: 200, right: 800, width: 600 }, viewport, opts);
    expect(caretTop).toBe(18);
  });

  it("never exceeds the viewport height", () => {
    const short = { width: 1440, height: 400 };
    const { style } = anchorBeside(card(100), short, { ...opts, maxHeight: 560 });
    expect(style.maxHeight).toBe(400 - 16);
  });
});

describe("max height", () => {
  it("is 70vh until 560px caps it", () => {
    expect(peekPopoverMaxHeight(600)).toBe(420);
    expect(peekPopoverMaxHeight(1200)).toBe(560);
  });
});

describe("surface choice", () => {
  it("uses the popover only on hover-capable viewports at least 768px wide", () => {
    expect(peekSurfaceFor(1440, true)).toBe("popover");
    expect(peekSurfaceFor(PEEK_POPOVER_MIN_WIDTH, true)).toBe("popover");
    // Touch: no hover to keep a popover open, so the bottom sheet.
    expect(peekSurfaceFor(1440, false)).toBe("sheet");
    expect(peekSurfaceFor(390, true)).toBe("sheet");
    expect(peekSurfaceFor(767, true)).toBe("sheet");
  });
});
