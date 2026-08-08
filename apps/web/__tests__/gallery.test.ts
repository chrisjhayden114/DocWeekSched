import { describe, expect, it } from "vitest";
import { galleryPreview } from "../lib/gallery";

/**
 * G2 — the Moments gallery preview: up to `cap` tiles render in-card and the
 * remainder overflows into a "+N" badge on the last tile.
 */
describe("G2 — galleryPreview", () => {
  it("1 image: shown as-is, no overflow", () => {
    const result = galleryPreview(["a.jpg"]);
    expect(result.shown).toEqual(["a.jpg"]);
    expect(result.extra).toBe(0);
    expect(result.gridCount).toBe(1);
  });

  it("exactly 4 images: full grid, no overflow", () => {
    const result = galleryPreview(["a", "b", "c", "d"]);
    expect(result.shown).toHaveLength(4);
    expect(result.extra).toBe(0);
    expect(result.gridCount).toBe(4);
  });

  it("7 images with cap 4: 4 shown, +3 overflow", () => {
    const result = galleryPreview(["a", "b", "c", "d", "e", "f", "g"], 4);
    expect(result.shown).toHaveLength(4);
    expect(result.extra).toBe(3);
    expect(result.gridCount).toBe(4);
  });

  it("no images: everything zero/empty", () => {
    const result = galleryPreview([]);
    expect(result.shown).toEqual([]);
    expect(result.extra).toBe(0);
    expect(result.gridCount).toBe(0);
  });
});
