import { describe, expect, it } from "vitest";
import {
  clampPercent,
  clientPointToPercent,
  percentToPixel,
  pinRelativePosition,
} from "@event-app/shared";

describe("map pin percentage positioning", () => {
  it("clamps to 0–100", () => {
    expect(clampPercent(-10)).toBe(0);
    expect(clampPercent(110)).toBe(100);
    expect(clampPercent(42.5)).toBe(42.5);
    expect(clampPercent(Number.NaN)).toBe(0);
  });

  it("converts client clicks to percentages", () => {
    const rect = { left: 100, top: 50, width: 400, height: 200 };
    expect(clientPointToPercent(100, 50, rect)).toEqual({ x: 0, y: 0 });
    expect(clientPointToPercent(300, 150, rect)).toEqual({ x: 50, y: 50 });
    expect(clientPointToPercent(500, 250, rect)).toEqual({ x: 100, y: 100 });
  });

  it("keeps relative position stable across render sizes (390px → desktop)", () => {
    const x = 37.5;
    const y = 62.5;
    const mobile = { width: 390, height: 260 };
    const desktop = { width: 720, height: 480 };

    const a = pinRelativePosition(x, y, mobile.width, mobile.height);
    const b = pinRelativePosition(x, y, desktop.width, desktop.height);
    expect(a.relX).toBeCloseTo(b.relX, 10);
    expect(a.relY).toBeCloseTo(b.relY, 10);
    expect(a.relX).toBeCloseTo(0.375, 10);
    expect(a.relY).toBeCloseTo(0.625, 10);

    const pxMobile = percentToPixel(x, y, mobile.width, mobile.height);
    const pxDesktop = percentToPixel(x, y, desktop.width, desktop.height);
    expect(pxMobile.left / mobile.width).toBeCloseTo(pxDesktop.left / desktop.width, 10);
    expect(pxMobile.top / mobile.height).toBeCloseTo(pxDesktop.top / desktop.height, 10);
  });
});
