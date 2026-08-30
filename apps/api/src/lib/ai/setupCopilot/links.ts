/**
 * AGENT-3 — clickable navigation in the organizer chat (CHAT-2 pattern).
 *
 * Anchors are the Organizer Guide topics with WE-minted event-scoped hrefs;
 * only topics that appear verbatim in the reply become links, so navigation
 * offers always match what the organizer reads. No model URLs, ever.
 */

import {
  ORGANIZER_GUIDE,
  resolveOrganizerGuideHref,
  type ConciergeLink,
} from "@event-app/shared";
import { linkifyReply, type LinkifyAnchor } from "../concierge/linkify";

/**
 * Organizer Guide anchors for one event ({eventId} substituted).
 * GUIDE-1 topics (Sponsor outreach, CFP, Registration fees, Certificates,
 * Maps, Polls, Session feedback) are minted here automatically — they
 * live on ORGANIZER_GUIDE, so adding an entry is what registers the anchor.
 */
export function buildOrganizerGuideAnchors(eventId: string): LinkifyAnchor[] {
  return ORGANIZER_GUIDE.map((entry) => ({
    label: entry.topic,
    href: resolveOrganizerGuideHref(entry.href, eventId),
  }));
}

/** Scan a settings-mode reply for guide topics and mint navigation offers. */
export function linkifyOrganizerReply(reply: string, eventId: string): ConciergeLink[] {
  return linkifyReply(reply, buildOrganizerGuideAnchors(eventId));
}
