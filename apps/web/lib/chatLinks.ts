/**
 * CHAT-2 — inline navigation links inside assistant chat bodies.
 *
 * The server attaches deterministic { label, href } links to a reply
 * (lib/ai/concierge/linkify.ts). Here we split the body text into segments
 * so labels render as in-app links exactly where they appear. Only internal
 * ("/…") hrefs may become links — an external href is never inlined, no
 * matter what the payload claims.
 */

import { stripAssistantEmphasis } from "./assistantText";

export type ChatLink = { label: string; href: string };

export type ChatSegment =
  | { type: "text"; text: string }
  | { type: "link"; text: string; href: string };

/** In-app path only: starts with a single "/" ("//host" is protocol-relative). */
export function isInternalHref(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

/**
 * Split `body` into text/link segments. Matching mirrors the server:
 * case-insensitive, longest label first, non-overlapping, first occurrence,
 * one span per link. Links whose label is absent (or whose href is not
 * internal) simply claim nothing — the caller keeps those as chips.
 */
export function splitByLinks(body: string, links: ChatLink[]): ChatSegment[] {
  const haystack = body.toLowerCase();
  const claims: Array<{ start: number; end: number; href: string }> = [];

  const candidates = links
    .filter((l) => l.label.trim().length > 0 && isInternalHref(l.href))
    .sort((a, b) => b.label.length - a.label.length);

  for (const link of candidates) {
    if (claims.some((c) => c.href === link.href)) continue;
    const needle = link.label.toLowerCase();
    let at = haystack.indexOf(needle);
    while (at !== -1) {
      const end = at + needle.length;
      if (!claims.some((c) => at < c.end && end > c.start)) break;
      at = haystack.indexOf(needle, at + 1);
    }
    if (at === -1) continue;
    claims.push({ start: at, end: at + needle.length, href: link.href });
  }

  claims.sort((a, b) => a.start - b.start);

  const segments: ChatSegment[] = [];
  let cursor = 0;
  for (const claim of claims) {
    if (claim.start > cursor) {
      segments.push({ type: "text", text: body.slice(cursor, claim.start) });
    }
    segments.push({ type: "link", text: body.slice(claim.start, claim.end), href: claim.href });
    cursor = claim.end;
  }
  if (cursor < body.length || segments.length === 0) {
    segments.push({ type: "text", text: body.slice(cursor) });
  }
  return segments;
}

/** The links splitByLinks did NOT inline — these stay in the chip row. */
export function unmatchedLinks(segments: ChatSegment[], links: ChatLink[]): ChatLink[] {
  const inlined = new Set(segments.filter((s) => s.type === "link").map((s) => s.href));
  return links.filter((l) => !inlined.has(l.href));
}

/**
 * Shared assistant render path used by ConciergeChat and SetupCopilotChat.
 * Strips markdown emphasis, then splits deterministic links. Do not call
 * this on user-typed messages.
 */
export function prepareAssistantBody(
  body: string,
  links: ChatLink[],
): { segments: ChatSegment[]; leftover: ChatLink[] } {
  const text = stripAssistantEmphasis(body);
  const segments = splitByLinks(text, links);
  return { segments, leftover: unmatchedLinks(segments, links) };
}
