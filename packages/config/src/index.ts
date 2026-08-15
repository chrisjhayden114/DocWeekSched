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
  /** Subprocessors named in the privacy policy (Chunk B). */
  subprocessors: [
    { name: "Neon", role: "PostgreSQL hosting" },
    { name: "Render", role: "API hosting" },
    { name: "Netlify", role: "Web hosting" },
    { name: "Resend", role: "Transactional email" },
    { name: "Stripe", role: "Merchant of record (payments, tax)" },
    { name: "Anthropic", role: "AI processing for organizer-initiated features" },
    { name: "Sentry", role: "Error tracking" },
    { name: "Better Stack", role: "Uptime monitoring and status page" },
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
 * Search-facing marketing copy (Chunk E25). The launch channel is inbound
 * search: buyers type category problems ("conference schedule software"),
 * not brand names, so every marketing <title> leads with category words and
 * ends with the brand. The hero H1 tagline is separate and unchanged — it
 * converts humans; these strings convert searchers.
 *
 * Marketing surfaces ONLY. Signed-in app pages keep their "Brand — Page"
 * titles. Edit this module, not the pages.
 */
export const marketingSeo = {
  /** Plain category descriptor — rendered near the wordmark (footer, hero). */
  categoryLine: "Event software for academic conferences",
  /** Homepage <title>: category first, brand last — the pattern for every marketing title. */
  seoTitle: `Conference schedule software for academic events — ${brand.productName}`,
  pages: {
    home: {
      title: `Conference schedule software for academic events — ${brand.productName}`,
      description:
        "Turn a conference program — PDF, Word, Excel or paste — into a published event site in minutes. Papers and presentations with ordered authors, CFP, calm notifications.",
    },
    pricing: {
      title: `Pricing — open, no sales calls — ${brand.productName} conference software`,
      description:
        "Open pricing for conference schedule software: a free tier, one-time per-event plans, and Pro subscriptions. Every price is public — no sales calls, no quote gate.",
    },
    help: {
      title: `Help — ${brand.productName} conference software`,
      description:
        "Guides for publishing a conference program online — importing sessions from PDF, Word, Excel or CSV, organizing papers, presentations and speakers, and attendee FAQs.",
    },
    security: {
      title: `Security & data practices — ${brand.productName} conference software`,
      description:
        "Security and data practices for conference software: architecture, subprocessors, data export and continuity, and the product principles we publish as true.",
    },
    /** Comparison pages (Chunk E27) — highest-intent "alternative" queries. */
    compareSched: {
      title: `Sched alternative for academic conferences — ${brand.productName} vs Sched`,
      description:
        "Sched alternative for academic conferences: papers inside sessions with ordered authors, AI import of the PDF or Word programme you already have, and open pricing.",
    },
    compareWhova: {
      title: `Whova alternative for academic conferences — ${brand.productName} vs Whova`,
      description:
        "Whova alternative for academic conferences: public pricing without a sales call, calm digest-first notifications, and papers, authors and CFP in the data model.",
    },
  },
} as const;

/** <title> for a help article: article topic first (what the searcher asked), brand last. */
export function marketingArticleTitle(articleTitle: string): string {
  return `${articleTitle} — ${brand.productName} conference software`;
}

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
    MOMENTS: "Upload one or more photos, tag people from the directory, and add a caption.",
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
  },
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
