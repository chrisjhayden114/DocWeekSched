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
 *   resolves, maps, announcements, ops, readiness — only when the event's
 *   resolved features enable it, features, recap), the
 *   ?settings=1 slide-over, or the sibling pages (ingest, sponsors,
 *   cfp, scanner, analytics). "{eventId}" is substituted server-side via
 *   resolveOrganizerGuideHref before a link is ever attached.
 * - plan-gated surfaces (sponsors, ops_agent, recap_agent, checkin,
 *   analytics, certificates, session_polls, session_feedback) say
 *   "if your plan includes it" — the assistant must not promise a
 *   surface the plan turned off. Sponsor outreach is entitled on every
 *   tier (Free capped at 25 prospects).
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
    text: "Upload a PDF, Word, Excel/CSV, or image of your program, paste text, or fetch a URL, and the AI drafts the agenda — or use Describe it to generate a skeleton from a short description. You review the result first, and confirming creates DRAFT sessions only.",
  },
  {
    id: "participants-tab",
    topic: "Participants",
    href: "/organizer/events/{eventId}?tab=participants",
    text: "Invite one person by name and email, or add people from a spreadsheet without emailing them (they show as Not invited until you send invites). Bulk-invite via CSV (dry run first), set participant labels, and manage the roster — including Make admin and Remove participant. When Registration fees is on, the Payment column records who has paid. Copyable join links live on the same tab.",
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
    id: "sponsor-outreach",
    topic: "Sponsor outreach",
    href: "/organizer/events/{eventId}/sponsors",
    text: "On the Sponsors page, Outreach is a private pipeline (To contact, Contacted, In conversation, Confirmed, Declined). Add prospects by hand or CSV import, save templates, then Write email (mailto) or Draft with AI — you send from your own address; the platform never sends outreach. Included in every plan: Free is capped at 25 prospects per event; paid plans have no cap. Outreach needs Sponsors to be on.",
  },
  {
    id: "cfp-page",
    topic: "CFP",
    href: "/organizer/events/{eventId}/cfp",
    text: "The CFP page is where you open a call, edit rubric criteria, assign reviewers, decide, and convert an accept into a draft session. Rename the call (default Call for Presentations) in Event settings under More options.",
  },
  {
    id: "registration-fees",
    topic: "Registration fees",
    href: "/organizer/events/{eventId}?tab=participants",
    text: "Turn on Registration fees (paid_attendance) on the Features tab. The Registration fee section on the Participants tab publishes fee text, a payment URL, and instructions — the platform never processes money. The roster Payment column records unpaid, PO on file, paid, waived, or refunded; a mark-paid CSV can update many rows at once.",
  },
  {
    id: "certificates",
    topic: "Certificates",
    href: "/organizer/events/{eventId}?tab=recap",
    text: "If your plan includes it, define eligibility (any check-in, a minimum number of joined sessions, or a required-session list), then batch-issue from Recap. Eligible people get an email with a download link; anyone can confirm a certificate on the public /verify page. PDFs use this event's accent color and logo.",
  },
  {
    id: "maps-tab",
    topic: "Maps",
    href: "/organizer/events/{eventId}?tab=maps",
    text: "The Maps tab is where you upload floor plans, drop pins, and optionally link each pin to a room. Attendees see those maps on their Maps tab when venue maps is on.",
  },
  {
    id: "session-polls",
    topic: "Polls",
    href: "/organizer/events/{eventId}?tab=features",
    text: "If your plan includes it, turn on Live polls in the Features tab. On a session page, draft a multiple-choice poll (2–12 options), then open and close it during the session. Attendees vote on the same Live polls card.",
  },
  {
    id: "session-feedback",
    topic: "Session feedback",
    href: "/organizer/events/{eventId}?tab=features",
    text: "If your plan includes it, turn on Session feedback in the Features tab. After a session ends, attendees leave a 1–5 rating and optional comment on the session page; organizers see the count, average, and comments there.",
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
    text: "Included in every plan — enable “Speaker & Session Readiness” on the Features tab and this event grows a Readiness tab (the Free plan tracks up to 10 presenters per event). The Readiness tab tracks what every speaker and session still needs before show day. Create a template (a named set of requirements like bio, headshot, slides, AV needs), assign it to speakers or sessions, and follow per-requirement status, due dates, and waivers from the readiness table. For a speaker, send a presenter portal invite from their detail panel — they get a 30-day link to submit materials without creating an account; you can resend or revoke that link, then approve or reject what they send. Chasing is automatic and needs nothing from you: an invited presenter is emailed once when a due date is 7 days away, once at 2 days, and once when it has passed — one email covering all of their open items, and never a fourth. Each reminder carries a fresh portal link: resending sends a new 30-day link while the presenter's previous link keeps working until its own expiry, and revoking kills every link at once. Approved and waived items are never chased, and the reminders appear in the activity history so you can see what went out.",
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
    text: "The Features tab holds the attendee feature toggles with presets (Everything on / Focused / Academic / PD day / Talk showcase); press Save features to apply. You can also ask me here — feature changes always show a review card before anything is applied.",
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
    text: "Open Event settings (the Settings button in the console header) to edit the name, description, dates, timezone, and venue or online URL. The public slug, CFP label (what you call the call for proposals), brand color, logo, and banner are under More options inside the slide-over.",
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
    id: "org-settings",
    topic: "Organization settings",
    href: "/organizer/org/settings",
    text: "Organization in the Workspace sidebar is where an owner or admin renames the organization — the “Hosted by” name on every public event page — and adds a website, a support email, and an organization logo. With a website saved the hosted-by name becomes a link; with a support email saved attendees get a Contact organizer link beside it. The organization logo is used by any event that hasn't uploaded one of its own, and is offered as a suggestion in the create-event wizard. At the bottom of the page, an owner can transfer ownership to another admin (promote them to admin first) or close the organization once nothing is left in it — closing keeps draft and archived events on record but ends the workspace, and it is what frees an owner to delete their account. An event can move to another organization while it is still a draft with no payments, certificates, AI usage, or series: use Move to another organization in Event settings. A published event stays where it is; to run it elsewhere, create it in the other organization and re-import the program.",
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
