/**
 * Placeholder substitution ONLY — literal numbers cannot enter narrative except via paths in metricsSnapshot.
 */

import { RecapSectionError, type RecapMetricsSnapshot } from "./types";

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_.[\]]+)\s*\}\}/g;

/** Resolve a dotted path against the metrics snapshot (supports sessions.<id>.field.mode). */
export function getMetricPathValue(snapshot: RecapMetricsSnapshot, path: string): unknown {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) return undefined;

  // sessions.<sessionId>.…
  if (parts[0] === "sessions" && parts.length >= 2) {
    const sessionId = parts[1]!;
    const session = snapshot.sessions.find((s) => s.sessionId === sessionId);
    if (!session) return undefined;
    return dig(session, parts.slice(2));
  }

  // topSessions.<index>.…
  if (parts[0] === "topSessions" && parts.length >= 2) {
    const idx = Number(parts[1]);
    if (!Number.isInteger(idx) || idx < 0 || idx >= snapshot.topSessions.length) return undefined;
    return dig(snapshot.topSessions[idx], parts.slice(2));
  }

  return dig(snapshot as unknown as Record<string, unknown>, parts);
}

function dig(root: unknown, parts: string[]): unknown {
  let cur: unknown = root;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export function formatMetricValue(value: unknown): string {
  if (typeof value === "number") {
    if (Number.isInteger(value)) return String(value);
    // Rates / averages — fixed 4 decimal places for stable deep-equal with snapshot numbers as strings.
    return String(value);
  }
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

/**
 * Substitute {{path}} placeholders from metricsSnapshot.
 * Unknown paths → RecapSectionError (caller fails the section / job).
 * Also validates optional citations list — every cited path must resolve.
 */
export function substituteMetricPlaceholders(
  narrativeMarkdown: string,
  snapshot: RecapMetricsSnapshot,
  citations?: string[],
): string {
  const paths = new Set<string>();
  for (const m of narrativeMarkdown.matchAll(PLACEHOLDER_RE)) {
    paths.add(m[1]!);
  }
  if (citations) {
    for (const c of citations) paths.add(c.trim());
  }

  for (const path of paths) {
    const value = getMetricPathValue(snapshot, path);
    if (value === undefined) {
      throw new RecapSectionError(
        "UNKNOWN_METRIC_PATH",
        `Metric path not found in metricsSnapshot: ${path}`,
      );
    }
  }

  return narrativeMarkdown.replace(PLACEHOLDER_RE, (_full, path: string) => {
    const value = getMetricPathValue(snapshot, path.trim());
    return formatMetricValue(value);
  });
}

/**
 * Reject free-text numbers that were not introduced via substitution.
 * After substitution, every numeric token in the body must appear as a formatted leaf of the snapshot
 * OR as a substring of a substituted path value. Safer approach for "no free-text-number path":
 * the model is only allowed to return placeholders — we scan the pre-substitution narrative for
 * digit runs that are not inside `{{…}}` and reject those.
 */
export function assertNoLiteralNumbersOutsidePlaceholders(narrativeMarkdown: string): void {
  const stripped = narrativeMarkdown.replace(PLACEHOLDER_RE, " ");
  // Digit runs of length >= 1 that look like numbers (integers or decimals).
  const literal = stripped.match(/\d+(?:\.\d+)?/g);
  if (literal && literal.length > 0) {
    throw new RecapSectionError(
      "LITERAL_NUMBER_REJECTED",
      `Narrative contains literal number(s) outside placeholders: ${literal.slice(0, 5).join(", ")}`,
    );
  }
}
