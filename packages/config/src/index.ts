/**
 * Central product branding / legal config.
 * Rename the product by changing this module only — do not hardcode the name elsewhere.
 */
export const brand = {
  /**
   * NEUTRAL LAUNCH NAME — "Colloquium" is NOT trademark-cleared yet.
   * Launching under the existing UKEDL identity; swap in the cleared final
   * name here (one line) + redeploy once the attorney signs off.
   */
  productName: "UKEDL",
  domain: "ukedl.com",
  /** Absolute origin for canonical URLs / OG (no trailing slash). */
  primaryUrl: "https://ukedl.com",
  supportEmail: "support@ukedl.com",
  legalEntity: "UKEDL (sole proprietorship; entity formation pending)",
  logoAlt: "Product logo",
  /** Reserved public demo event slug (seeded in Phase 6 Chunk C). */
  demoEventSlug: "demo",
  /** Internal/founder org that owns the public demo (plan INTERNAL — not customer limits). */
  /**
   * Internal org slug is never rendered publicly — keeping the original value
   * so existing seeded demo data (dev) stays owned by the same org; the
   * demo-reset org check would otherwise refuse the old demo event.
   */
  internalOrgSlug: "colloquium-internal",
  internalOrgName: "Platform Internal",
  /** Honest support hours — used by ToS / security / help. */
  supportHours: "Weekdays 9:00–17:00 US Pacific. Event-day coverage is best-effort.",
  /**
   * Cookie consent banner: OFF.
   * Deliberate choice — today we set only essential session/CSRF cookies (see apps/api/src/lib/cookies.ts).
   * No non-essential analytics cookies are set. If Phase S3 adds Plausible/PostHog-class cookies that
   * require consent, flip this to true and ship a banner + privacy update in the same session.
   */
  cookieConsentRequired: false,
  /** Product principles (anti-goals) — published on /security. */
  productPrinciples: [
    "No ads",
    "No attendee-data monetization",
    "No engagement bait",
  ],
  /** Live Better Stack status page (uptime monitoring configured 2026-08-02). */
  statusPageUrl: "https://ukedl.betteruptime.com",
  social: {
    x: "https://x.com/ukedl",
    linkedin: "https://www.linkedin.com/company/ukedl",
  },
  /**
   * Subprocessors named in the privacy policy.
   * Regions are founder-read from the live dashboards where we have them;
   * remaining providers are labeled "United States–based provider" only —
   * do not invent a region.
   */
  subprocessors: [
    { name: "Neon", role: "PostgreSQL hosting", region: "AWS us-east-1 (N. Virginia, USA)" },
    { name: "Render", role: "API hosting", region: "Virginia (US East), USA" },
    { name: "Netlify", role: "Web hosting", region: "Global CDN, US-based provider" },
    { name: "Cloudflare", role: "Object storage (R2)", region: "Western North America (WNAM)" },
    { name: "Resend", role: "Transactional email", region: "United States–based provider" },
    { name: "Stripe", role: "Merchant of record (payments, tax)", region: "United States–based provider" },
    { name: "Anthropic", role: "AI processing for event assistant conversations and organizer AI features (drafts and answers; disclosed in-product)", region: "United States–based provider" },
    { name: "Sentry", role: "Error tracking", region: "United States–based provider" },
    { name: "Better Stack", role: "Uptime monitoring and status page", region: "United States–based provider" },
  ],
  colors: {
    ink: "#18253F",
    primary: "#0033A0",
    goldDecorative: "#E8C547",
  },
  /**
   * Legacy client storage keys from the pre-rename release. Dual-read these for one release;
   * always write the current keys in `clientStorageKeys`.
   */
  legacyClientStorageKeys: {
    linkedEventContext: "eventPilotLinkedContext",
    theme: "eventPilotTheme",
  },
  clientStorageKeys: {
    linkedEventContext: "linkedEventContext",
    theme: "appTheme",
  },
} as const;

export type BrandConfig = typeof brand;

/**
 * Auth / consent copy. Edit here, not on the login form.
 */
export const authCopy = {
  ageAttestation: "I am 16 or older",
  ageAttestationRequired: "Please confirm you are 16 or older.",
} as const;

/**
 * Search-facing marketing copy (Chunk E25). The launch channel is inbound
 * search: buyers type category problems ("conference schedule software",
 * "PD day software", "speaker management"), not brand names, so every
 * marketing <title> leads with category words and ends with the brand.
 * The hero H1 tagline is separate — it converts humans; these strings
 * convert searchers.
 *
 * Marketing surfaces ONLY. Signed-in app pages keep their "Brand — Page"
 * titles. Edit this module, not the pages.
 */
export const marketingSeo = {
  /** Plain category descriptor — rendered near the wordmark (footer, hero). */
  categoryLine: "Calm event software for conferences and PD days in education.",
  /** Homepage <title>: category first, brand last — the pattern for every marketing title. */
  seoTitle: `Conference and PD day software — schedule builder + Speaker Readiness — ${brand.productName}`,
  pages: {
    home: {
      title: `Conference and PD day software — schedule builder + Speaker Readiness — ${brand.productName}`,
      description:
        "Excel, PDF, Word, paste, or describe your program. Speaker management and materials collection with automatic reminders. Personal agendas, no app download.",
    },
    pricing: {
      title: `Conference and PD day software pricing — open, no sales calls — ${brand.productName}`,
      description:
        "Open pricing for conference and PD day software: a free tier, one-time per-event plans, and Pro. Every price is public — budget without emailing anyone.",
    },
    help: {
      title: `Help for conference and PD day software — ${brand.productName}`,
      description:
        "Guides for conference and PD day software — importing from Excel, PDF, Word, paste or a description, Speaker Readiness, and attendee FAQs.",
    },
    security: {
      title: `Security & data practices for conference and PD day software — ${brand.productName}`,
      description:
        "Security and data practices for conference and PD day software: architecture, subprocessors, data export and deletion, and the product principles we publish as true.",
    },
    /** Comparison pages (Chunk E27) — highest-intent "alternative" queries. */
    compareSched: {
      title: `Sched alternative for conferences and PD days — ${brand.productName} vs Sched`,
      description:
        "Sched alternative for conferences and PD days: program import from Excel, PDF, Word, paste or a description, Speaker Readiness, personal agendas, no app.",
    },
    compareWhova: {
      title: `Whova alternative for conferences and PD days — ${brand.productName} vs Whova`,
      description:
        "Whova alternative for conferences and PD days: public pricing without a sales call, Speaker Readiness with automatic reminders, personal agendas, no app download.",
    },
    speakerReadiness: {
      title: `Speaker management and content collection for conferences and PD days — Speaker Readiness — ${brand.productName}`,
      description:
        "Speaker management and content collection for conferences and PD days: bios, slides, forms, and agreements — automatic reminders, no presenter account.",
    },
    featureGuide: {
      title: `Feature guide for conference and PD day software — ${brand.productName}`,
      description:
        "What each event feature does, where attendees and organizers see it, and what stays when you turn a toggle off.",
    },
  },
} as const;

/** <title> for a help article: article topic first (what the searcher asked), brand last. */
export function marketingArticleTitle(articleTitle: string): string {
  return `${articleTitle} — ${brand.productName} conference software`;
}

/**
 * Speaker Readiness concierge rates (founder decision 2026-08-26).
 *
 * These are SERVICE prices for hands-on setup and event-week support. The
 * software itself is included in every plan — Free included — so nobody has
 * to buy a service to get the feature. Rates are strings on purpose: they are
 * quoted, not charged through Stripe, and are not SKUs in
 * packages/shared/src/plans.ts.
 */
const READINESS_SERVICE_PROMISE =
  "We map your data, build your templates, send the invites, and stay hands-on through your event — direct founder support.";

export type ReadinessServiceTier = {
  id: string;
  /** Who the rate is for. */
  name: string;
  /** The scale it covers — the thing a buyer matches themselves against. */
  scale: string;
  price: string;
  /** Only the top tier is scoped rather than fixed; null elsewhere. */
  priceNote: string | null;
  description: string;
};

export const speakerReadinessService: {
  mailtoSubject: string;
  /** Identical to every tier's `description` — rendered once above the table. */
  promise: string;
  tiers: readonly ReadinessServiceTier[];
} = {
  mailtoSubject: "Speaker Readiness concierge",
  promise: READINESS_SERVICE_PROMISE,
  tiers: [
    {
      id: "education_small",
      name: "Education & community",
      scale: "Schools, PD days, TEDx-style — under 50 presenters",
      price: "$150",
      priceNote: null,
      description: READINESS_SERVICE_PROMISE,
    },
    {
      id: "education_large",
      name: "Education & community",
      scale: "50–150 presenters",
      price: "$350",
      priceNote: null,
      description: READINESS_SERVICE_PROMISE,
    },
    {
      id: "standard",
      name: "Standard concierge",
      scale: "150–500 presenters",
      price: "$750",
      priceNote: null,
      description: READINESS_SERVICE_PROMISE,
    },
    {
      id: "large",
      name: "Large or complex",
      scale: "500+ presenters, multi-track associations",
      price: "from $1,250",
      priceNote: "individually scoped",
      description: READINESS_SERVICE_PROMISE,
    },
  ],
};

export function speakerReadinessServiceMailto(): string {
  return `mailto:${brand.supportEmail}?subject=${encodeURIComponent(speakerReadinessService.mailtoSubject)}`;
}

/**
 * Presenter-facing reminder email copy (ER5). The API builder
 * (`buildReadinessReminderEmail`) and the /speaker-readiness mock both import
 * this so the marketing page cannot drift from the mail that actually sends.
 */
export const readinessReminderCopy = {
  subjectDue: (eventName: string) => `Reminder: materials due for ${eventName}`,
  subjectOverdue: (eventName: string) => `Reminder: materials overdue for ${eventName}`,
  greeting: (speakerName: string) => `Hi ${speakerName},`,
  /** `eventName` is interpolated as-is — the HTML builder wraps it in <strong>. */
  bodyDue: (eventName: string) => `A reminder about the materials ${eventName} still needs from you.`,
  bodyOverdue: (eventName: string) => `Some materials for ${eventName} are past their due date.`,
  portalCta: "Open your presenter portal",
  linkExpiryNote:
    "This link works for 30 days. Links from earlier emails keep working until their own expiry.",
  linkFallback: "If the button does not work, copy this link into your browser:",
  alreadySent: "Already sent these? Your organizer may still be reviewing — no action needed.",
  itemDue: (formattedDate: string) => `due ${formattedDate}`,
  itemNoDue: "no due date",
  itemOverdue: "overdue",
} as const;

/**
 * Organizer-console copy for what a session can hold (Chunk E11.3).
 * One combined "+ Add" entry point, two preserved models — Paper and
 * SessionResource stay separate models with separate endpoints; only the
 * wording lives here. Edit this module, not the components.
 */
export const programCopy = {
  /** Rendered as "+ {addEntryLabel}" under each session in the Program tab. */
  addEntryLabel: "Add paper or resource",
  paper: {
    noun: "Paper",
    hint: "A paper or presentation — authors or presenters in order, with an optional abstract. Appears in the program under the session.",
  },
  resource: {
    noun: "Resource",
    hint: "A link or file, e.g. slides, a reading list, a Drive folder.",
    /**
     * Shown above the add-resource form (Chunk E12.4). Plain English only —
     * never mention the transport (the 4.5 MB ceiling is the browser
     * request-encoding limit, RESOURCE_DATA_URL_MAX_CHARS, not a storage limit).
     */
    shareHint: "Add a link, or upload a file up to 4.5 MB. Anyone who joins this session can open it.",
  },
} as const;

/**
 * Session editor drawer copy (Chunk E30.1).
 * The Edit/New session drawer shows ONE materials area: the three upload
 * targets (image / recording / materials file) are different data fields on
 * the session, so all three stay — but only the materials upload renders as
 * a full dropzone; image and recording use the compact attach affordance so
 * the drawer never shows two identical empty dropzones. Edit this module,
 * not the component.
 */
export const sessionEditorCopy = {
  editTitle: "Edit session",
  newTitle: "New session",
  closeLabel: "Close session editor",
  sections: {
    basics: "Basics",
    schedule: "Schedule",
    speakers: "Speakers",
    materials: "Materials",
    roster: "Roster & waitlist",
  },
  materials: {
    /** One orienting line under the Materials heading. */
    hint: "Links and files attendees can open from the session page.",
    linkPlaceholder: "Presentation or resource link",
    uploadLabel: "Materials file",
    uploadHint: "Slides, a paper, a handout — PDF, Office, image, audio or video.",
    attachedLabel: "Materials file attached",
    removeAttachment: "Remove",
    imagePlaceholder: "Image URL",
    imageUploadLabel: "Session image",
    recordingPlaceholder: "Recording URL",
    recordingUploadLabel: "Recording file",
    meetingLinkPlaceholder: "Online meeting link",
  },
  actions: {
    save: "Save changes",
    create: "Create session",
    saving: "Saving…",
    cancel: "Cancel",
    delete: "Delete session",
  },
} as const;

/**
 * Empty states that teach (Chunk E30.3): a short line of what the area is
 * for plus where the primary action lives. Calm, not cute. Edit this module,
 * not the components.
 */
export const emptyStateCopy = {
  sessionDiscussion: {
    title: "Ask the first question",
    body: "Questions and discussion for this session live here — everyone attending can read and reply. Use “Ask a question” above.",
  },
  waitlist:
    "No one is waiting for a seat. When this session reaches capacity, attendees can join the waitlist and you can promote them from here.",
} as const;

/**
 * Pattern-kit shared copy (Chunk F1, DESIGN_PHASE_F).
 * Screen-specific strings (a composer's invitation, an empty state's
 * headline) are passed as props by each screen; only the generic strings
 * every kit instance shares live here. Edit this module, not the
 * components in apps/web/components/kit/.
 */
export const kitCopy = {
  composer: {
    /** Collapse the expanded composer without sending; the draft is kept. */
    cancel: "Cancel",
    /** Shown on the submit button while the async submit is in flight. */
    busy: "Sending…",
  },
  slideOver: {
    /** aria-label for the ✕ button in the SlideOver header. */
    close: "Close",
    /** Progressive-disclosure toggle for advanced fields (F1.2 #7). */
    moreOptions: "More options",
  },
} as const;

/**
 * Community copy (Chunk F3.1, DESIGN_PHASE_F) — the content-first board:
 * wayfinding header, channel pills, the on-demand composer (with its
 * per-channel hints and inline validation), and teaching empty states.
 * Edit this module, not dashboard.tsx.
 */
export const communityCopy = {
  header: {
    title: "Community",
    purpose: "Meet-ups, moments, local tips, and introductions — spaces for everyone at this event.",
    postCount: (n: number) => `${n} post${n === 1 ? "" : "s"}`,
  },
  /** Channel pill labels (the filter row). */
  channels: {
    ALL: "All",
    MEETUP: "Meet-ups",
    MOMENTS: "Moments",
    LOCAL: "Local tips",
    ICEBREAKER: "Break the ice",
    GENERAL: "General",
  },
  composer: {
    collapsed: "Start a post…",
    submit: "Post",
    titlePlaceholder: "Title",
    bodyPlaceholder: "Description or message",
    /** Channel picker label, shown when composing from the All view. */
    postInLabel: "Post in",
  },
  /** One orienting line inside the expanded composer, per channel. */
  hints: {
    MEETUP: "Propose a meet-up and invite specific people, or open it to everyone at this event.",
    MOMENTS: "A photo, a title, or a caption — any one is enough. You can also tag people from the directory.",
    LOCAL: "Recommend a place and paste a Google Maps link so others can open it in Maps.",
    ICEBREAKER: "Welcome others — share a quick intro or icebreaker prompt.",
    GENERAL: "Open discussion for everyone at this event.",
  },
  /** Inline composer validation — never window.alert. */
  errors: {
    meetupLink: "Add a video link for virtual meet-ups (Zoom, Google Meet, Teams, etc.).",
    meetupParticipants: "Add at least one participant, or choose “Invite everyone”.",
    mapsSearchNeedsText: "Type a place name to search Maps.",
    createFailed: "Could not create the post.",
  },
  /** Teaching empty states, per channel (an invitation, never "Nothing here yet"). */
  empty: {
    action: "Start a post",
    ALL: {
      title: "Start the conversation",
      body: "Introductions, plans, questions for everyone — the first post sets the tone.",
    },
    GENERAL: {
      title: "Start the conversation",
      body: "Open discussion for everyone at this event — the first post sets the tone.",
    },
    MEETUP: {
      title: "Propose the first meet-up",
      body: "Coffee, dinner, a walk between sessions — invite specific people or everyone at the event.",
    },
    MOMENTS: {
      title: "Share the first moment",
      body: "Photos from talks, posters, and everything in between — tag the people in them.",
    },
    LOCAL: {
      title: "Share a local tip",
      body: "Know a good spot near the venue? Recommend it with a Maps link so others can find it.",
    },
    ICEBREAKER: {
      title: "Break the ice",
      body: "Introduce yourself — where you're from, what you work on, what you're hoping to get from the event.",
    },
  },
} as const;

/**
 * K-6 — organizer console tab hover cards. One honest paragraph per tab:
 * what lives there and when you'd open it. Label-trigger, text-only.
 * Edit this module, not ConsoleTabStrip / the event page.
 */
export const consoleTabCopy = {
  overview:
    "Overview is the event home: publish or unpublish, see session, speaker, and registration counts, and work through the setup checklist. Open it for the state of the event at a glance, or to jump into importing the program, editing sessions, or opening the attendee app.",
  program:
    "Program is where you add and edit sessions, tracks, and rooms, including bulk assignment. Draft sessions stay hidden from attendees until you publish them. Come here to build the schedule by hand after an ingest, or to fix a room or a time.",
  people:
    "Speakers is the roster of people who appear on the public schedule next to their sessions. Add speakers here; paper authors and presenters for a specific session are still managed on Program. Use it when you are building or correcting the public speaker list.",
  readiness:
    "Readiness tracks what each accepted speaker or session still needs — bios, slides, forms — from a template you assign once. Presenters get a personal link (no account) to upload or paste a slides URL; you approve or request a change. Open it once Speaker & Session Readiness is on, especially in the weeks before show day.",
  invites:
    "Participants is the full roster: invite one person, bulk-invite by CSV, make someone an admin, or remove them. Copyable join links live here too, along with participant labels and — when Registration fees is on — the Payment column. Use it whenever you are adding people or checking who has registered.",
  maps:
    "Maps is where you upload floor-plan images and drop pins that stay put when the plan scales. A pin can link to a room so today’s sessions show on it. Use it to give attendees a way to find rooms; turning the feature off hides the attendee Maps tab but keeps your plans.",
  announcements:
    "Announcements is organizer broadcast — compose a notice to attendee inboxes, optionally also by email, aimed at everyone, a role, session joiners, or an attendance mode. Preview to yourself before sending. Use it for schedule changes and anything that should interrupt, not for back-and-forth (that is Community).",
  features:
    "Features is the per-event toggle board: Community channels, messaging, session tools, and the rest, with presets you can still edit after. Save applies the set. Use it to turn a surface on or off for this event, and to edit Event assistant FAQ and starters under the toggles.",
  ops:
    "Ops Inbox watches the event and drafts cards for you — session changes, stale Q&A, low check-in, capacity pressure, a community blocklist hit, and a daily digest. Nothing sends until you apply or dismiss a card. Open it when you want a suggested-action list rather than hunting through the other tabs.",
  recap:
    "Recap builds the post-event report after the end date: synthesized sections, thank-you email drafts, and a metrics export. Generate is blocked until the event has ended. Come here after the event to review, send, or export — attendees never see this builder.",
  certificates:
    "Certificates is where you design the certificate and set who earns one — our built-in layout with your accent colour and logo, or a finished design you upload from Canva or anywhere else, with each attendee's name placed on it. Eligibility can be a check-in, a minimum number of sessions joined, or a required-session list. Issuing itself happens on Recap once the event has ended.",
} as const;

/**
 * Session Q&A copy (Chunk F3.2, DESIGN_PHASE_F) — threads lead, asking is
 * on demand. Edit this module, not pages/session/[sessionId].tsx.
 */
export const sessionQaCopy = {
  title: "Session Q&A",
  purpose: "Ask questions, upvote what matters, and (for organizers) mark answered or hide. Updates every few seconds.",
  sortLabel: "Sort questions",
  sortVotes: "Top votes",
  sortRecent: "Recent",
  composer: {
    collapsed: "Ask a question…",
    submit: "Post question",
    titlePlaceholder: "Question title",
    bodyPlaceholder: "What would you like to ask or discuss?",
  },
  answeredPill: "Answered",
  votes: (n: number) => `${n} vote${n === 1 ? "" : "s"}`,
  replies: (n: number) => `${n} repl${n === 1 ? "y" : "ies"}`,
} as const;

/**
 * Messages copy (Chunk F3.3, DESIGN_PHASE_F) — light touch only: the
 * wayfinding header and the kit empty state. Phase-1 messaging behavior
 * (E18) is unchanged. Edit this module, not MessagesPanel.tsx.
 */
export const messagesCopy = {
  title: "Messages",
  purpose: "Private 1:1 and group conversations with people at this event.",
  newMessage: "New message",
  closeNew: "Close",
  empty: {
    title: "No conversations yet",
    body: "Start one from an attendee's profile, a session, or the Break the ice tab.",
    action: "Browse attendees",
  },
} as const;

/**
 * Organizer Overview copy (Chunk F2, DESIGN_PHASE_F).
 * The content-first event home: wayfinding state line, stat labels, the
 * "Before you publish" checklist frame, quick actions, and the relocated
 * settings SlideOver. Edit this module, not the page/components.
 */
export const overviewCopy = {
  stateLine: {
    /** "3 steps from publishing" — drafts counting down to Publish. */
    stepsFromPublishing: (n: number) => `${n} step${n === 1 ? "" : "s"} from publishing`,
    /** Live events with loose ends (e.g. draft sessions still hidden). */
    stepsRemaining: (n: number) => `${n} setup step${n === 1 ? "" : "s"} remaining`,
    setupComplete: "Setup complete",
  },
  actions: {
    publish: "Publish",
    preview: "Preview public page",
    /** Event-scoped jump into /dashboard?tab=Agenda (sets activeEventId). */
    openAttendeeApp: "Open attendee app",
    settings: "Settings",
  },
  /** Post-publish success block (H1 / DESIGN_PHASE_H D4). */
  publishSuccess: {
    liveAt: (slug: string) => `Your event is live at ${brand.domain}/e/${slug}`,
    copyLink: "Copy link",
    copied: "Copied",
    viewAsAttendees: "View as attendees",
  },
  stats: {
    sessions: "Sessions",
    speakers: "Speakers",
    registered: "Registered",
    rooms: "Rooms",
  },
  checklist: {
    /** Panel title while the event is still draft. */
    title: "Before you publish",
    /** Panel title once the event is live. */
    titleLive: "Event setup",
    nextStepLabel: "Next step:",
    complete: "Setup complete. Sessions, rooms, speakers, and venue are in place and the event is live.",
  },
  quickActions: {
    label: "Quick actions",
    importProgram: {
      title: "Import program",
      body: "Paste, upload, or link a program document — the assistant drafts the schedule for review.",
    },
    editProgram: {
      title: "Edit program",
      body: "Tracks, rooms, and sessions — build or adjust the schedule by hand.",
    },
    preview: {
      title: "Preview public page",
      body: "See the event exactly as attendees do.",
      /** Shown instead of the link while the event is still draft. */
      draftHint: "Available once the event is published.",
    },
    openAttendeeApp: {
      title: "Open attendee app",
      body: "Agenda, messages, and community — exactly what a participant sees.",
    },
    /** INV-1 — deep link to the Participants tab. */
    manageParticipants: {
      title: "Manage participants",
      body: "Invite people one at a time or by CSV, and manage the roster.",
    },
  },
  advanced: {
    label: "Publishing & advanced",
    unpublish: "Unpublish (back to Draft)",
    archive: "Archive",
    unarchive: "Unarchive to Draft",
    statusHelp:
      "Draft events 404 for outsiders. Published events are reachable via slug/join link. Archive hides them from attendees while keeping data.",
  },
  settings: {
    title: "Event settings",
    intro:
      "Everything from the create wizard, editable after the fact. Changing the timezone keeps the wall-clock times below and reinterprets them in the new zone.",
    save: "Save settings",
    saving: "Saving…",
    saved: "Saved — event details updated.",
    cancel: "Cancel",
    /** Dirty-close guard (carried over from the old dashboard modal). */
    discardTitle: "Discard changes?",
    discardBody: "You have unsaved event settings. Close without saving?",
    discardConfirm: "Discard",
    fields: {
      name: "The name attendees and organizers see everywhere — the public page, the attendee app, and the console.",
      description:
        "A short public summary of the event. Shown on the public page and in some invite emails.",
      timezone:
        "The event’s wall-clock zone. Changing it keeps the start and end times below as typed and reinterprets them in the new zone — a 9:00 start stays 9:00, in the new timezone.",
      dates:
        "Start and end in event time. These bound the published agenda and what attendees see as “during the event.”",
      venueName: "Building or site name shown on the public page and in the attendee app.",
      venueAddress: "Street address for in-person events. Optional if you only have a venue name.",
      onlineUrl: "Join link for a virtual or hybrid event. Shown to attendees when you publish it.",
      slug: "The public URL path: /e/your-slug. Lowercase letters, numbers, and single hyphens.",
      brandColor:
        "Accent for buttons and highlights in the console, the public page, and the attendee app. Leave empty for the neutral platform look.",
      logo: "Small mark next to the event name in the console and on the public page. Square images work best.",
      banner: "Wide header image on the public event page. Optional.",
      participantLabels:
        "Labels attendees can pick for this event — departments, cohorts, roles. You can override a person’s label on the roster. Removing a label clears it from anyone who had it.",
      cfpLabel:
        "What you call the public call — Call for Presentations, Call for Papers, Call for Workshops. This name is used in the organizer sidebar and console headings. Public pages still show each form’s own title.",
      paymentPriceText: "Free text, so tiers and member rates read the way you say them.",
      paymentUrl: "Your own checkout or invoice page. Attendees get a button that opens it.",
      paymentInstructions: "POs and checks belong here — many districts can't pay by card.",
    },
  },
} as const;

/**
 * Organization settings copy (ORG-1, DESIGN_PHASE_J §Org entity).
 * The organization stopped being an invisible billing shell and became the
 * host an attendee can see and write to. It is identity, not a billboard:
 * there is no public organization page, so every string here has to earn its
 * place on an EVENT page or in the console. Edit this module, not the page.
 */
export const orgSettingsCopy = {
  title: "Organization",
  backLabel: "All events",
  intro:
    "Who your events say they are hosted by. The name, website, and support email appear on your public event pages; the logo stands in for any event that hasn’t uploaded one of its own.",
  save: "Save organization",
  saving: "Saving…",
  saved: "Saved — organization details updated.",
  /** STAFF can see the settings but not change them (OWNER/ADMIN only). */
  readOnly:
    "Only an owner or admin can change these. Ask one of them if something here is wrong.",
  /** Shown above the form when the user belongs to more than one organization. */
  pickerLabel: "Organization",
  fields: {
    name: "The host name on every public event page, and the workspace name in billing and invoices. Changing it updates all of them at once.",
    websiteUrl:
      "Your own site. With one saved, “Hosted by …” on your public event pages becomes a link to it. Leave it empty and the name stays plain text.",
    supportEmail:
      "Where attendees should write with questions about your events. Shown as a quiet “Contact organizer” link beside the host name. Leave it empty and no contact link appears.",
    logo: "Used by any event that hasn’t uploaded a logo of its own — your crest without re-uploading it for every event. An event that picks its own logo always keeps it. Square images work best.",
    description:
      "A short note about your organization, for your own reference. Not shown to attendees anywhere today.",
  },
  /** Says out loud that the description is the one field nobody else sees. */
  descriptionPrivacyNote: "Internal — attendees never see this.",
  /**
   * Create-event wizard, under the branding step. A suggestion the organizer
   * can see and delete — never a value quietly attached on submit (BRAND-2
   * prefill-not-seed).
   */
  logoPrefillNote: (orgName: string) =>
    `Suggested from ${orgName}. Clear it if this event has a logo of its own.`,
} as const;

/**
 * Customer-facing billing status copy (Chunk E24).
 * The raw SubscriptionStatus enum (NONE / ACTIVE / TRIALING / PAST_DUE /
 * CANCELED) must never be rendered on a customer surface. A status line is
 * shown only when it tells the customer something the plan name and price do
 * not already say. Edit this module, not the billing page.
 */
export const billingCopy = {
  status: {
    trial: "Free trial",
    trialEnds: (endsOn: string) => `Free trial — ends ${endsOn}`,
    /** The one that earns money: say what failed and what to do. */
    pastDue: (planName: string) => `Payment failed — update your card to keep ${planName}.`,
    cancelledEnds: (planName: string, endsOn: string) => `Cancelled — ${planName} access ends ${endsOn}.`,
    cancelledPaidThrough: (planName: string) =>
      `Cancelled — ${planName} access continues until the end of the period you already paid for.`,
  },
  /** Friendly labels for payment-provider invoice statuses (Stripe et al. send lowercase). */
  invoiceStatus: {
    paid: "Paid",
    open: "Awaiting payment",
    draft: "Draft",
    void: "Void",
    uncollectible: "Uncollectible",
    pending: "Pending",
    failed: "Failed",
    refunded: "Refunded",
  } as Record<string, string>,
} as const;

export type SubscriptionStatusLine = {
  text: string;
  /** "danger" = act now (payment failed); "warning" = heads-up; "neutral" = informational. */
  tone: "neutral" | "warning" | "danger";
};

/**
 * Decide whether the billing page shows a subscription status line, and what
 * it says. Returns null when there is nothing worth telling the customer —
 * NONE and ACTIVE add nothing to the plan name and price, and unknown enum
 * values must never leak to a customer surface.
 */
export function subscriptionStatusLine(input: {
  /** Raw SubscriptionStatus enum value from the API — never rendered directly. */
  subscriptionStatus: string;
  /** Plan tier id ("FREE", "PRO", …) — decides whether CANCELED still matters. */
  planTier: string;
  /** Display plan name, e.g. "Pro". */
  planName: string;
  /** Pre-formatted, locale-appropriate dates; omit when unknown. */
  trialEndsOn?: string | null;
  paidAccessEndsOn?: string | null;
}): SubscriptionStatusLine | null {
  switch (input.subscriptionStatus) {
    case "TRIALING":
      return {
        text: input.trialEndsOn ? billingCopy.status.trialEnds(input.trialEndsOn) : billingCopy.status.trial,
        tone: "neutral",
      };
    case "PAST_DUE":
      return { text: billingCopy.status.pastDue(input.planName), tone: "danger" };
    case "CANCELED":
      // After the downgrade the org is FREE and the plan panel already says
      // Free — never print a cancellation notice beside the Free plan.
      if (input.planTier === "FREE") return null;
      return {
        text: input.paidAccessEndsOn
          ? billingCopy.status.cancelledEnds(input.planName, input.paidAccessEndsOn)
          : billingCopy.status.cancelledPaidThrough(input.planName),
        tone: "warning",
      };
    default:
      return null;
  }
}

/** Map a provider invoice status ("paid", "open", …) to a customer-facing label. */
export function invoiceStatusLabel(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (!key) return "";
  return billingCopy.invoiceStatus[key] ?? key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ");
}

/** ICS PRODID / calendar identity derived from brand (never hardcode product name). */
export function icsProductId(calendar = "Agenda"): string {
  return `-//${brand.productName}//${calendar}//EN`;
}
