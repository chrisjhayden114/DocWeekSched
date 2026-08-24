/**
 * W-1 — placement rules for the portal-rendered Select listbox and KebabMenu
 * panel. Their old CSS positioning was relative to the trigger's box; in the
 * portal these numbers are the whole of it.
 */

import { describe, expect, it } from "vitest";
import { anchorPopup, type AnchorRect } from "../lib/popupAnchor";

const viewport = { width: 1000, height: 800 };

/** A 200px-wide trigger whose top edge sits at `top`. */
const trigger = (top: number, left = 100, width = 200): AnchorRect => ({
  top,
  bottom: top + 36,
  left,
  right: left + width,
  width,
});

describe("vertical placement", () => {
  it("sits just below the trigger when there is room", () => {
    const { placement, style } = anchorPopup(trigger(100), viewport, { align: "stretch" });
    expect(placement).toBe("below");
    expect(style.position).toBe("fixed");
    expect(style.top).toBe(140);
    expect(style.bottom).toBeUndefined();
  });

  it("flips above the trigger when the space below is too tight", () => {
    const { placement, style } = anchorPopup(trigger(700), viewport, { align: "stretch" });
    expect(placement).toBe("above");
    // Measured from the viewport bottom up to the trigger's top edge.
    expect(style.bottom).toBe(viewport.height - 700 + 4);
    expect(style.top).toBeUndefined();
  });

  it("stays below when neither side fits but below has more room", () => {
    const short = { width: 1000, height: 200 };
    const { placement } = anchorPopup(trigger(60), short, { align: "stretch" });
    expect(placement).toBe("below");
  });

  it("caps max-height at the free space, never past the requested ceiling", () => {
    // 800 - 336 - 4 - 8 = 452 of room, so the ceiling wins.
    expect(anchorPopup(trigger(300), viewport, { align: "stretch" }).style.maxHeight).toBe(260);
    // 800 - 588 - 4 - 8 = 200 of room, below the 260 ceiling.
    expect(anchorPopup(trigger(552), viewport, { align: "stretch" }).style.maxHeight).toBe(200);
  });

  it("keeps a scrollable minimum rather than collapsing in a cramped viewport", () => {
    const cramped = { width: 1000, height: 150 };
    const { style } = anchorPopup(trigger(60), cramped, { align: "stretch" });
    expect(style.maxHeight).toBe(96);
  });
});

describe("horizontal alignment", () => {
  it("stretch matches the trigger's box, like the old left/right: 0", () => {
    const { style } = anchorPopup(trigger(100), viewport, { align: "stretch" });
    expect(style.left).toBe(100);
    expect(style.width).toBe(200);
    expect(style.minWidth).toBeUndefined();
  });

  it("start grows rightward from the trigger, at least as wide as it", () => {
    const { style } = anchorPopup(trigger(100), viewport, { align: "start", maxWidth: 320 });
    expect(style.left).toBe(100);
    expect(style.minWidth).toBe(200);
    expect(style.maxWidth).toBe(320);
    expect(style.width).toBeUndefined();
  });

  it("end hangs off the trigger's right edge, like the old right: 0", () => {
    const { style } = anchorPopup(trigger(100, 900, 36), viewport, { align: "end" });
    expect(style.right).toBe(viewport.width - 936);
    expect(style.left).toBeUndefined();
  });
});

describe("viewport clamping", () => {
  it("pulls a stretched popup back inside the right edge", () => {
    const { style } = anchorPopup(trigger(100, 900, 200), viewport, { align: "stretch" });
    expect(style.left).toBe(viewport.width - 8 - 200);
  });

  it("never places a popup left of the margin", () => {
    const { style } = anchorPopup(trigger(100, -40, 200), viewport, { align: "stretch" });
    expect(style.left).toBe(8);
  });

  it("shrinks a start-aligned popup to the space left of the viewport edge", () => {
    const { style } = anchorPopup(trigger(100, 800, 150), viewport, { align: "start", maxWidth: 320 });
    expect(style.maxWidth).toBe(viewport.width - 8 - 800);
  });

  it("emits finite pixel values with no width cap requested", () => {
    const { style } = anchorPopup(trigger(100, 900, 36), viewport, { align: "end" });
    expect(Number.isFinite(style.maxWidth)).toBe(true);
  });
});
