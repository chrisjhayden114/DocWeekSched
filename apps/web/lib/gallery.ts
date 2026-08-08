/** G2 — how many photos to show in-card and how many overflow into "+N". */
export function galleryPreview(images: string[], cap = 4): {
  shown: string[]; extra: number; gridCount: number;
} {
  const shown = images.slice(0, cap);
  return { shown, extra: Math.max(0, images.length - shown.length), gridCount: Math.min(images.length, cap) };
}
