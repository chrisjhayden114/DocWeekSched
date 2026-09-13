/**
 * AGENDA-1 — placement rules for the session peek popover. It sits *beside* its
 * card (sched.com), so the interesting cases are which side wins, when neither
 * does, and where the caret ends up once the vertical position is clamped.
 *
 * UI-5 — the caret is the part that says which card the panel belongs to, so
 * these cases pin it hard: it tracks the card's centre through every clamp, on
 * whichever axis the placement uses, and it is measured against the panel that
 * was actually painted rather than the height it was allowed.
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
  });

  it("flips above when it cannot go beside and there is no room below", () => {
    const narrow = { width: 900, height: 900 };
    const { placement } = anchorBeside(card(800, 40, 820), narrow, opts);
    expect(placement).toBe("above");
  });
});

describe("vertical placement and the caret", () => {
  it("centres on the card and points the caret at its middle", () => {
    const { style, caretOffset } = anchorBeside(card(300), viewport, opts);
    const cardMid = 340;
    expect(style.top).toBe(cardMid - 560 / 2);
    // Centred, so the caret sits at the popover's own midpoint.
    expect(caretOffset).toBe(280);
  });

  it("clamps to the viewport top and moves the caret to follow the card", () => {
    const { style, caretOffset } = anchorBeside(card(20), viewport, opts);
    expect(style.top).toBe(8);
    // Card middle is 60px down the page, i.e. 52px below the popover's top —
    // near the top inset, nowhere near the panel's own 280px midpoint.
    expect(caretOffset).toBe(52);
  });

  it("clamps to the viewport bottom", () => {
    const { style } = anchorBeside(card(860), viewport, opts);
    expect(style.top).toBe(viewport.height - 8 - 560);
  });

  /**
   * The regression UI-5 fixes: the panel is clamped to the viewport, so a card
   * low on the page ends up well below the panel's own centre. A caret pinned
   * at 50% would point at whichever card happens to be halfway up the panel.
   */
  it("follows a card that sits below the panel's centre", () => {
    const { style, caretOffset } = anchorBeside(card(780), viewport, opts);
    const cardMid = 820;
    expect(style.top).toBe(332);
    expect(caretOffset).toBe(cardMid - 332);
    // Well past the midpoint, and still inside the panel.
    expect(caretOffset).toBeGreaterThan(560 / 2);
    expect(caretOffset).toBeLessThanOrEqual(560 - 18);
  });

  it("keeps the caret off the popover's rounded corners at both ends", () => {
    // A card scrolled off the top of the page would otherwise put the caret
    // at 0 (or above it); one at the bottom, past the panel's last corner.
    const offTop = anchorBeside({ top: -40, bottom: 0, left: 200, right: 800, width: 600 }, viewport, opts);
    expect(offTop.caretOffset).toBe(18);
    const offBottom = anchorBeside(card(1200), viewport, opts);
    expect(offBottom.caretOffset).toBe(560 - 18);
  });

  /**
   * `maxHeight` is a ceiling, not a height: a short session fills 200px of the
   * 560px allowed. Clamping the caret against the ceiling put it as much as
   * 360px below the panel's own bottom edge — a caret pointing at nothing.
   */
  it("clamps the caret against the painted height, not the ceiling", () => {
    const measured = { width: PEEK_POPOVER_WIDTH, height: 200 };
    const short = anchorBeside(card(300), viewport, { ...opts, measured });
    // Centred on the card for real now, so the caret is the panel's midpoint.
    expect(short.style.top).toBe(240);
    expect(short.caretOffset).toBe(100);
    // The ceiling is still what the panel may grow to.
    expect(short.style.maxHeight).toBe(560);
    // Unmeasured, the same card put the caret past the end of that panel.
    expect(anchorBeside(card(300), viewport, opts).caretOffset).toBeGreaterThan(measured.height);
  });

  it("never exceeds the viewport height", () => {
    const short = { width: 1440, height: 400 };
    const { style } = anchorBeside(card(100), short, { ...opts, maxHeight: 560 });
    expect(style.maxHeight).toBe(400 - 16);
  });
});

describe("the caret on the below/above fallback", () => {
  const narrow = { width: 900, height: 900 };
  // A full-width card: neither side has room for the 420px panel.
  const wide = card(200, 40, 820);

  it("points at the card's centre x, measured from the panel's left edge", () => {
    const { placement, style, caretOffset } = anchorBeside(wide, narrow, {
      ...opts,
      // A dropdown panel stretches to the card's width, so that is the box the
      // caret is clamped inside.
      measured: { width: 820, height: 300 },
    });
    expect(placement).toBe("below");
    expect(style.left).toBe(40);
    // Card centre 450, panel's left edge 40.
    expect(caretOffset).toBe(410);
  });

  it("keeps the same inset off the panel's corners", () => {
    // A panel narrower than the card it hangs under: the card's centre is past
    // the panel's far corner, so the caret stops at the inset instead.
    const { style, caretOffset } = anchorBeside(wide, narrow, opts);
    expect(style.left).toBe(40);
    expect(caretOffset).toBe(PEEK_POPOVER_WIDTH - 18);
  });

  it("keeps pointing at the card when the panel flips above it", () => {
    const { placement, caretOffset } = anchorBeside(card(800, 40, 820), narrow, {
      ...opts,
      measured: { width: 820, height: 300 },
    });
    expect(placement).toBe("above");
    expect(caretOffset).toBe(410);
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
