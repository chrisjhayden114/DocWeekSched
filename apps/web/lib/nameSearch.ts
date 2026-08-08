/**
 * G1b — shared people-search matcher. Splits the query into whitespace tokens
 * and requires EVERY token to be a case-insensitive substring of the haystack,
 * so "chen maya", "maya chen", "may", and "chen" all match "Dr. Maya Chen"
 * (first name, last name, and out-of-order multi-word queries all work).
 */
export function matchesNameQuery(haystack: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = haystack.toLowerCase();
  return q.split(/\s+/).every((token) => hay.includes(token));
}
