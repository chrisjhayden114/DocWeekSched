import { normalizeTitle } from "./schema";

/**
 * Dice coefficient on character bigrams of normalized titles.
 * Match threshold for re-import: ≥ 0.85 + same calendar day.
 */
export function titleSimilarity(a: string, b: string): number {
  const aa = normalizeTitle(a);
  const bb = normalizeTitle(b);
  if (!aa || !bb) return 0;
  if (aa === bb) return 1;

  const bigrams = (s: string): Map<string, number> => {
    const map = new Map<string, number>();
    if (s.length < 2) {
      map.set(s, 1);
      return map;
    }
    for (let i = 0; i < s.length - 1; i += 1) {
      const g = s.slice(i, i + 2);
      map.set(g, (map.get(g) || 0) + 1);
    }
    return map;
  };

  const A = bigrams(aa);
  const B = bigrams(bb);
  let overlap = 0;
  let sizeA = 0;
  let sizeB = 0;
  for (const n of A.values()) sizeA += n;
  for (const n of B.values()) sizeB += n;
  for (const [g, n] of A) {
    const m = B.get(g) || 0;
    overlap += Math.min(n, m);
  }
  if (sizeA + sizeB === 0) return 0;
  return (2 * overlap) / (sizeA + sizeB);
}

export const REIMPORT_TITLE_THRESHOLD = 0.85;
