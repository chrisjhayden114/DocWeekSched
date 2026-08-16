/**
 * CHAT-2 — deterministic link extraction from a model reply.
 *
 * The model never emits URLs we trust. Instead, after a grounded reply comes
 * back, we scan it for anchors WE minted server-side: corpus session titles
 * (→ /session/{id}) and App Guide topics / dashboard destinations (→ the
 * guide's own in-app hrefs). Only text that actually appears in the reply
 * becomes a link, so navigation offers always match what the user reads.
 */

import { APP_GUIDE, type ConciergeLink } from "@event-app/shared";
import type { GroundingContext } from "../types";

export type LinkifyAnchor = { label: string; href: string };

/** Max navigation offers per assistant message — calm, not a link farm. */
export const LINKIFY_MAX_LINKS = 6;

/** Session titles shorter than this are too ambiguous to anchor ("Break"). */
const MIN_SESSION_TITLE_CHARS = 8;

/** Dashboard tab names the assistant may name as plain destinations. */
const DESTINATION_TABS = [
  "Profile",
  "Messages",
  "Maps",
  "Notifications",
  "Community",
  "Agenda",
] as const;

/**
 * Anchors for one event: grounded session titles first, then App Guide
 * topics, then bare destination words. All hrefs are server-minted in-app
 * paths — never model output.
 */
export function buildLinkifyAnchors(corpus: Pick<GroundingContext, "sessions">): LinkifyAnchor[] {
  const anchors: LinkifyAnchor[] = [];
  for (const session of corpus.sessions) {
    const title = session.title.trim();
    if (title.length >= MIN_SESSION_TITLE_CHARS) {
      anchors.push({ label: title, href: `/session/${session.id}` });
    }
  }
  for (const entry of APP_GUIDE) {
    anchors.push({ label: entry.topic, href: entry.href });
  }
  for (const tab of DESTINATION_TABS) {
    anchors.push({ label: tab, href: `/dashboard?tab=${tab}` });
  }
  return anchors;
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

/** True when [start, end) overlaps any claimed range. */
function overlapsClaimed(start: number, end: number, claimed: Array<[number, number]>): boolean {
  return claimed.some(([s, e]) => start < e && end > s);
}

/**
 * Scan `reply` for anchor labels and return the navigation offers to attach:
 * case-insensitive, longest label wins overlaps, one link per href, capped
 * at LINKIFY_MAX_LINKS, only labels that appear verbatim in the reply (on
 * word boundaries, so "Maps" never fires inside "roadmaps"). Results come
 * back in reply order. Pure function.
 */
export function linkifyReply(reply: string, anchors: LinkifyAnchor[]): ConciergeLink[] {
  const haystack = reply.toLowerCase();
  const claimed: Array<[number, number]> = [];
  const seenHrefs = new Set<string>();
  const found: Array<{ at: number; link: ConciergeLink }> = [];

  const sorted = anchors
    .filter((a) => a.label.trim().length > 0 && a.href.startsWith("/"))
    .sort((a, b) => b.label.length - a.label.length);

  for (const anchor of sorted) {
    if (found.length >= LINKIFY_MAX_LINKS) break;
    if (seenHrefs.has(anchor.href)) continue;

    const needle = anchor.label.toLowerCase();
    let at = haystack.indexOf(needle);
    while (at !== -1) {
      const end = at + needle.length;
      const boundaryOk = !isWordChar(reply[at - 1]) && !isWordChar(reply[end]);
      if (boundaryOk && !overlapsClaimed(at, end, claimed)) break;
      at = haystack.indexOf(needle, at + 1);
    }
    if (at === -1) continue;

    claimed.push([at, at + needle.length]);
    seenHrefs.add(anchor.href);
    // Label = the reply's own text, so the UI can highlight it verbatim.
    found.push({ at, link: { label: reply.slice(at, at + needle.length), href: anchor.href } });
  }

  return found.sort((a, b) => a.at - b.at).map((f) => f.link);
}
