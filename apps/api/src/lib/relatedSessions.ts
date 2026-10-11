/**
 * PRESENTER-HOME-C — sessions that share vocabulary with one of the
 * presenter's sessions. Pure scoring: the portal route supplies candidates
 * already scoped to that event.
 *
 * Score is the Ochiai coefficient on token sets:
 *   |shared| / sqrt(|target| * |candidate|)
 * Tokens are unique. An empty set scores 0 (the divisor would be 0).
 */

/** Dropped after lowercasing. Tokens shorter than 3 characters are dropped too. */
export const RELATED_SESSION_STOP_WORDS = [
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "what",
  "how",
  "your",
  "our",
  "you",
  "are",
  "not",
  "but",
  "all",
  "can",
  "will",
  "into",
  "about",
  "when",
  "who",
  "session",
  "sessions",
  "day",
  "days",
  "school",
  "schools",
] as const;

const STOP_WORDS = new Set<string>(RELATED_SESSION_STOP_WORDS);

/** Formats that are not program sessions. Compared case-insensitively. */
const EXCLUDED_FORMATS = new Set(["break", "social"]);

export type RelatedSessionDoc = {
  id: string;
  title: string;
  description?: string | null;
  trackName?: string | null;
  format?: string | null;
  published: boolean;
  /** True when this session is one the presenter is on. */
  own?: boolean;
  startsAt: Date;
  endsAt: Date;
  items?: ReadonlyArray<{ title?: string | null; abstract?: string | null }>;
};

/** Lowercase, split on non-letters, drop short tokens and the stop list. */
export function relatedSessionTokens(parts: ReadonlyArray<string | null | undefined>): Set<string> {
  const out = new Set<string>();
  for (const part of parts) {
    if (!part) continue;
    const pieces = part.toLowerCase().split(/[^\p{L}]+/u);
    for (const token of pieces) {
      if (token.length < 3) continue;
      if (STOP_WORDS.has(token)) continue;
      out.add(token);
    }
  }
  return out;
}

export function tokensForRelatedSession(session: RelatedSessionDoc): Set<string> {
  const parts: Array<string | null | undefined> = [session.title, session.description, session.trackName];
  for (const item of session.items ?? []) {
    parts.push(item.title, item.abstract);
  }
  return relatedSessionTokens(parts);
}

export function relatedSessionScore(target: ReadonlySet<string>, candidate: ReadonlySet<string>): number {
  if (target.size === 0 || candidate.size === 0) return 0;
  let shared = 0;
  for (const token of target) {
    if (candidate.has(token)) shared += 1;
  }
  if (shared === 0) return 0;
  return shared / Math.sqrt(target.size * candidate.size);
}

function isExcluded(candidate: RelatedSessionDoc, targetId: string): boolean {
  if (candidate.id === targetId || candidate.own) return true;
  if (!candidate.published) return true;
  const format = candidate.format?.trim().toLowerCase() ?? "";
  return EXCLUDED_FORMATS.has(format);
}

/**
 * Top `limit` candidates with score > 0.
 * Ties break by startsAt ascending, then id, so the order is stable.
 */
export function relatedSessions<T extends RelatedSessionDoc>(
  target: RelatedSessionDoc,
  candidates: readonly T[],
  opts: { limit: number },
): T[] {
  const limit = Number.isFinite(opts.limit) ? Math.max(0, Math.floor(opts.limit)) : 0;
  if (limit === 0) return [];
  const targetTokens = tokensForRelatedSession(target);
  const ranked: Array<{ session: T; score: number }> = [];
  for (const candidate of candidates) {
    if (isExcluded(candidate, target.id)) continue;
    const score = relatedSessionScore(targetTokens, tokensForRelatedSession(candidate));
    if (score > 0) ranked.push({ session: candidate, score });
  }
  ranked.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    const byStart = a.session.startsAt.getTime() - b.session.startsAt.getTime();
    if (byStart !== 0) return byStart;
    return a.session.id < b.session.id ? -1 : a.session.id > b.session.id ? 1 : 0;
  });
  return ranked.slice(0, limit).map((row) => row.session);
}

/**
 * Half-open ranges: a session that ends when another starts does not overlap.
 * "Runs at the same time" needs a shared stretch of time, not a shared instant.
 */
export function overlapsYours(
  candidate: { startsAt: Date; endsAt: Date },
  presenterSessions: ReadonlyArray<{ startsAt: Date; endsAt: Date }>,
): boolean {
  const start = candidate.startsAt.getTime();
  const end = candidate.endsAt.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  return presenterSessions.some((session) => {
    const otherStart = session.startsAt.getTime();
    const otherEnd = session.endsAt.getTime();
    if (!Number.isFinite(otherStart) || !Number.isFinite(otherEnd)) return false;
    return start < otherEnd && otherStart < end;
  });
}
