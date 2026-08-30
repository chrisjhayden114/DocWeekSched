/**
 * CHAT-2 — the App Guide: how the attendee app works, stated once, here.
 *
 * The single source the Event assistant answers "how do I…" questions from
 * (serialized into its prompt) and the source of guide link anchors. Every
 * claim and href is verified against the app:
 * - hrefs use the dashboard tab names from pages/dashboard.tsx (Agenda,
 *   Attendees, Meet, Community, Maps, Messages, Notifications, Profile;
 *   ?tab= matching is case-insensitive) or the session page.
 * - flag-gated features (features.ts registry) say "if enabled for this
 *   event" — the assistant must not promise a surface the organizer turned
 *   off.
 *
 * Keep entries concise and single-line: they are matched verbatim inside a
 * bounded prompt budget. Update this file when the UI copy changes.
 */

export type AppGuideEntry = {
  id: string;
  /** Short, linkable name for the capability — also a linkify anchor. */
  topic: string;
  /** In-app path ("/…") the answer should point at. Never external. */
  href: string;
  /** One or two plain sentences, accurate to the shipped UI. */
  text: string;
};

export const APP_GUIDE: AppGuideEntry[] = [
  {
    id: "profile-basics",
    topic: "My Profile",
    href: "/dashboard?tab=Profile",
    text: "Edit your name, photo, title, affiliation, bio, and interests in the Profile tab, then press Save.",
  },
  {
    id: "directory-visibility",
    topic: "attendee directory visibility",
    href: "/dashboard?tab=Profile",
    text: "Turn on \u201cShow me in this event's attendee directory\u201d in Profile. It is opt-in and required for others to find you and message you \u2014 with it off you are not listed and cannot receive DMs.",
  },
  {
    id: "messaging-settings",
    topic: "messaging settings",
    href: "/dashboard?tab=Profile",
    text: "Profile holds \u201cWho can message me\u201d, \u201cShow read receipts\u201d, and \u201cEmail me about unread messages (max one per day)\u201d.",
  },
  {
    id: "message-requests",
    topic: "message requests",
    href: "/dashboard?tab=Messages",
    text: "A first message from someone new arrives quietly as a request in Messages; replying accepts it. Block or Report anyone from the thread's \u22ef menu.",
  },
  {
    id: "join-sessions",
    topic: "My Schedule",
    href: "/dashboard?tab=Agenda",
    text: "Press Join on a session row, or tap a timetable cell and join from the preview. Joined sessions collect under My Schedule in Agenda, where you can download an .ics calendar file.",
  },
  {
    id: "pick-one-breakouts",
    topic: "pick-one breakouts",
    href: "/dashboard?tab=Agenda",
    text: "If enabled for this event, you choose one session per timeslot; picking a different one asks you to confirm the swap, and Change reopens a decided slot.",
  },
  {
    id: "session-qa",
    topic: "session Q&A",
    href: "/dashboard?tab=Agenda",
    text: "If enabled for this event, ask questions on a session's own page; choose \u201cFor the presenter\u201d to direct a question to them.",
  },
  {
    id: "session-resources",
    topic: "session resources",
    href: "/dashboard?tab=Agenda",
    text: "Slides and links live on each session's page. Organizers can always add them; attendees can add their own after joining that session.",
  },
  {
    id: "like-vs-star",
    topic: "Like vs Star",
    href: "/dashboard?tab=Agenda",
    text: "Like is public appreciation (the count shows on the session); Star is your personal reminder \u2014 starred sessions alert you when they are about to start.",
  },
  {
    id: "venue-maps",
    topic: "venue maps",
    href: "/dashboard?tab=Maps",
    text: "If enabled for this event, the Maps tab shows floor plans with room pins so you can find where a session happens.",
  },
  {
    id: "timezone-toggle",
    topic: "timezone toggle",
    href: "/dashboard?tab=Agenda",
    text: "If enabled for this event, switch Agenda times between \u201cMy timezone\u201d and \u201cEvent timezone\u201d; the Agenda always states which one is shown.",
  },
  {
    id: "notifications-digest",
    topic: "Notifications",
    href: "/dashboard?tab=Notifications",
    text: "One inbox for this event \u2014 session changes and messages can notify you, and quieter community activity rolls into a daily digest. Open an item to jump to it.",
  },
  {
    id: "checkin-qr",
    topic: "check-in QR",
    href: "/dashboard?tab=Profile",
    text: "If enabled for this event, your personal check-in QR code sits at the top of Profile \u2014 show it at registration.",
  },
  {
    id: "community",
    topic: "Community",
    href: "/dashboard?tab=Community",
    text: "If enabled for this event, Community is where attendees post: meet-ups, shared moments, local recommendations, ice-breakers, and a general board.",
  },
  {
    id: "community-meetups",
    topic: "Meet-ups",
    href: "/dashboard?tab=Community",
    text: "If enabled for this event, pick the Meet-ups pill on Community to propose a gathering. Add a title, description, or photo, choose in-person or virtual (virtual needs a meeting URL), and invite everyone or a named list.",
  },
  {
    id: "community-moments",
    topic: "Moments",
    href: "/dashboard?tab=Community",
    text: "If enabled for this event, pick the Moments pill on Community to share photos. A post can be photos, a title, or a description (at least one), up to twelve images, with optional tags of people on the roster.",
  },
  {
    id: "community-icebreakers",
    topic: "Break the ice",
    href: "/dashboard?tab=Community",
    text: "If enabled for this event, pick the Break the ice pill on Community to post an intro or conversation starter. The people strip above the feed can open a prefilled message if Direct messages is on.",
  },
  {
    id: "certificates",
    topic: "Certificates",
    href: "/dashboard?tab=Profile",
    text: "If enabled for this event, you receive a certificate by email after the organizer batch-issues it — only if you meet their rule (any check-in, a minimum number of joined sessions, or a required-session list). The email has a download link; anyone can confirm it on the public /verify page.",
  },
  {
    id: "registration-fee",
    topic: "How to pay",
    href: "/dashboard",
    text: "If the organizer published a registration fee, the notice is informational: pay via their link or instructions (card, PO, or check). The platform never takes the money. Your status may be unpaid, PO on file, paid, waived, or refunded — only the organizer records it.",
  },
  {
    id: "meet-tab",
    topic: "Meet",
    href: "/dashboard?tab=Meet",
    text: "If enabled for this event, the Meet tab suggests people from shared interests. You must appear in the attendee directory and leave Match me on. Draft intro opens a message — nothing sends until you do.",
  },
  {
    id: "attendees-tab",
    topic: "Attendees",
    href: "/dashboard?tab=Attendees",
    text: "If enabled for this event, the Attendees tab lists people who opted into the directory. Turn on \u201cShow me in this event's attendee directory\u201d in Profile so others can find you.",
  },
  {
    id: "session-polls",
    topic: "Live polls",
    href: "/dashboard?tab=Agenda",
    text: "If enabled for this event, vote on the Live polls card on a session's own page. You see open or closed polls, not drafts; one vote per person.",
  },
  {
    id: "session-feedback",
    topic: "Session feedback",
    href: "/dashboard?tab=Agenda",
    text: "If enabled for this event, leave a 1–5 rating and an optional comment on a session's page after it has ended. Submitting again replaces your comment.",
  },
];
