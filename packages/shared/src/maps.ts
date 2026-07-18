/**
 * Percentage pin math — stable across render sizes (390px → desktop).
 */
export function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

/** Client click → pin % given element bounding box. */
export function clientPointToPercent(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  return {
    x: clampPercent(((clientX - rect.left) / rect.width) * 100),
    y: clampPercent(((clientY - rect.top) / rect.height) * 100),
  };
}

/** Pin % → pixel center for a given rendered image size. */
export function percentToPixel(
  xPercent: number,
  yPercent: number,
  width: number,
  height: number,
): { left: number; top: number } {
  return {
    left: (clampPercent(xPercent) / 100) * width,
    top: (clampPercent(yPercent) / 100) * height,
  };
}

/** Relative position (0–1) — identical for the same % at any render size. */
export function pinRelativePosition(
  xPercent: number,
  yPercent: number,
  width: number,
  height: number,
): { relX: number; relY: number } {
  const p = percentToPixel(xPercent, yPercent, width, height);
  return {
    relX: width === 0 ? 0 : p.left / width,
    relY: height === 0 ? 0 : p.top / height,
  };
}
