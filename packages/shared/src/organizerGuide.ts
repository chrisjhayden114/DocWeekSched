/**
 * AGENT-3 — the Organizer Guide: how the organizer console works, stated
 * once, here. The organizer-side mirror of CHAT-2's attendee App Guide.
 *
 * The single source the Setup assistant (settings mode) answers "how do I…"
 * and "what's left…" questions from (serialized into its prompt) and the
 * source of guide link anchors. Every claim and href is verified against
 * the console:
 * - event-scoped hrefs use the tab ids from
 *   pages/organizer/events/[eventId]/index.tsx (overview, program,
 *   people = Speakers, invites = Participants — ?tab=participants also
 *   resolves, maps, announcements, ops, readiness — pilot, only when the
 *   event's resolved features enable it, features, recap), the
 *   ?settings=1 slide-over, or the sibling pages (ingest, sponsors,
 *   scanner, analytics). "{eventId}" is substituted server-side via
 *   resolveOrganizerGuideHref before a link is ever attached.
 * - plan-gated surfaces (sponsors, ops_agent, recap_agent, checkin,
 *   analytics) say "if your plan includes it" — the assistant must not
 *   promise a surface the plan turned off.
 *
 * Feature CHANGES stay confirm-gated through the existing diff card; this
 * file only expands what the assistant KNOWS. Keep entries concise: they
 * are matched verbatim inside a bounded prompt budget. Update this file
 * when the console UI changes.
 */

import type { AppGuideEntry } from "./appGuide";

/** Substitute the event id into an Organizer Guide href. */
export function resolveOrganizerGuideHref(href: string, eventId: string): string {
  return href.replace(/\{eventId\}/g, eventId);
}

export const ORGANIZER_GUIDE: AppGuideEntry[] = [
  {
    id: "publish-event",
    topic: "Publish",
    href: "/organizer/events/{eventId}?tab=overview",
    text: "Press Publish on the Overview tab to go live: the event turns ACTIVE, draft sessions publish with it, and the public /e/ page starts working — draft events 404 for attendees. Unpublish and Archive sit under Publishing & advanced on the same tab.",
  },
  {
    id: "program-tab",
    topic: "Program",
    href: "/organizer/events/{eventId}?tab=program",
    text: "The Program tab is where you add and edit sessions, tracks, and rooms, including bulk track/room assignment. Draft sessions are badged and hidden from attendees; on a live event a single button publishes all draft sessions at once.",
  },
  {
    id: "agenda-ingest",
    topic: "Agenda ingest",
    href: "/organizer/events/{eventId}/ingest",
    text: "Upload a PDF, Word, Excel/CSV, or image of your program and the AI drafts the agenda, or use Describe it to generate a skeleton from a short description. You review the result first, and confirming creates DRAFT sessions only.",
  },
  {
    id: "participants-tab",
    topic: "Participants",
    href: "/organizer/events/{eventId}?tab=participants",
    text: "Invite one person by name and email, bulk-invite via CSV (with a dry run before anything sends), and manage the roster — including Make admin and Remove participant. Copyable join links (the permanent join link and the public page link) live on the same tab.",
  },
  {
    id: "speakers-tab",
    topic: "Speakers",
    href: "/organizer/events/{eventId}?tab=people",
    text: "Add speakers in the Speakers tab; they appear on the public schedule next to their sessions. Paper authors and presenters are managed on the Program tab under each session.",
  },
  {
    id: "sponsors-page",
    topic: "Sponsors",
    href: "/organizer/events/{eventId}/sponsors",
    text: "If your plan includes it, manage sponsors by tier with logos, booths, and descriptions, and export booth leads as CSV. Attendees see sponsors grouped by tier.",
  },
  {
    id: "announcements-tab",
    topic: "Announcements",
    href: "/organizer/events/{eventId}?tab=announcements",
    text: "Compose announcements to attendee inboxes (optionally also by email), targeted at everyone, a role, session joiners, or an attendance mode. You can preview to yourself before sending, and an emergency broadcast option exists for urgent notices.",
  },
  {
    id: "ops-inbox",
    topic: "Ops Inbox",
    href: "/organizer/events/{eventId}?tab=ops",
    text: "If your plan includes it, the Ops Inbox detects schedule changes, unanswered questions, low check-in, sessions near capacity, and moderation items, and drafts a suggested action for each. Nothing is ever sent to attendees until you review a draft and press Send or Apply.",
  },
  {
    id: "readiness-tab",
    topic: "Readiness",
    href: "/organizer/events/{eventId}?tab=readiness",
    text: "Pilot preview — if enabled for this event, the Readiness tab tracks what every speaker and session still needs before show day. Create a template (a named set of requirements like bio, headshot, slides, AV needs), assign it to speakers or sessions, and follow per-requirement status, due dates, and waivers from the readiness table. For a speaker, send a presenter portal invite from their detail panel — they get a 30-day link to submit materials without creating an account; you can resend or revoke that link, then approve or reject what they send.",
  },
  {
    id: "recap-tab",
    topic: "Recap",
    href: "/organizer/events/{eventId}?tab=recap",
    text: "If your plan includes it, Recap unlocks after the event end date and generates a report, feedback synthesis, certificates, and thank-you email drafts — sent only when you choose to send them.",
  },
  {
    id: "features-tab",
    topic: "Features",
    href: "/organizer/events/{eventId}?tab=features",
    text: "The Features tab holds the attendee feature toggles with presets (Everything on / Focused / Academic); press Save features to apply. You can also ask me here — feature changes always show a review card before anything is applied.",
  },
  {
    id: "pick-one-breakouts",
    topic: "Pick-one breakouts",
    href: "/organizer/events/{eventId}?tab=features",
    text: "Turn on Pick-one breakouts in the Features tab to make attendees choose one session per timeslot instead of joining freely.",
  },
  {
    id: "event-assistant-faq",
    topic: "Event assistant FAQ",
    href: "/organizer/events/{eventId}?tab=features",
    text: "Below the toggles on the Features tab you can edit the Event assistant FAQ and the Event assistant starters — the answers and starter questions the attendee-facing assistant draws on.",
  },
  {
    id: "event-settings",
    topic: "Event settings",
    href: "/organizer/events/{eventId}?settings=1",
    text: "Open Event settings (the Settings button in the console header) to edit the name, description, dates, timezone, and venue or online URL. The public slug, brand color, logo, and banner are under More options inside the slide-over.",
  },
  {
    id: "check-in",
    topic: "Check-in",
    href: "/organizer/events/{eventId}/scanner",
    text: "If your plan includes it, the Check-in page scans attendee QR codes (or takes a code typed by hand) and keeps a queue while offline, syncing when the connection returns.",
  },
  {
    id: "analytics-page",
    topic: "Analytics",
    href: "/organizer/events/{eventId}/analytics",
    text: "If your plan includes it, Analytics shows adoption, registrations over time, check-ins, and session popularity, with a session CSV download.",
  },
  {
    id: "billing-page",
    topic: "Billing",
    href: "/organizer/billing",
    text: "Billing shows your current plan, its limits (active events, attendees, AI ingest), and invoices, with upgrade and checkout on the same page.",
  },
  {
    id: "ai-usage-page",
    topic: "AI usage",
    href: "/organizer/ai-usage",
    text: "AI usage shows the last 30 days of metered AI calls, tokens, and estimated cost, broken down by feature.",
  },
  {
    id: "attendee-view",
    topic: "Open attendee app",
    href: "/organizer/events/{eventId}?tab=overview",
    text: "Once the event is live, Preview public page (on the Overview tab) opens the public /e/ page and Open attendee app opens the attendee dashboard for this event, so you can see exactly what attendees see.",
  },
];
