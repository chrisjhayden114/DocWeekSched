/**
 * SHOT-CI — the pure content spec for the screenshot seed.
 *
 * Mirrors the demoEvent fixture/writer split: this file is data only, so the
 * unit suite can assert coverage (every channel, mixed states, two days of
 * sessions) without a database. `seed.ts` turns it into rows.
 *
 * Every name here is invented. Northbridge is a fictional convention host —
 * do not swap in a real person, school, or company, because these rows are
 * photographed and published on the marketing site.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { FeatureKey, FeatureOverrideValue } from "@event-app/shared";
import { FEATURE_REGISTRY } from "@event-app/shared";

/** Known to CI and to the Playwright driver; never valid anywhere real. */
export const SCREENSHOT_SEED_PASSWORD = "Screenshot-CI-2026!";

export const SCREENSHOT_ORG_SLUG = "northbridge-conventions";
export const SCREENSHOT_EVENT_SLUG = "northbridge-learning-summit";
export const SCREENSHOT_BREAKOUT_EVENT_SLUG = "northbridge-pd-day";

export type ScreenshotUserSpec = {
  key: string;
  name: string;
  email: string;
  accountRole: "ADMIN" | "ATTENDEE" | "SPEAKER";
  eventRole: "ADMIN" | "ATTENDEE" | "SPEAKER" | "REVIEWER";
  title?: string;
  affiliation?: string;
  bio?: string;
  researchInterests?: string;
  participantType?: string;
  directoryOptIn: boolean;
  engagementPoints: number;
  /**
   * PAY-T0 string status (UNPAID | PO_ON_FILE | PAID | WAIVED | REFUNDED).
   * `null` means this event never tracked a fee for them, which the Payment
   * column renders differently from UNPAID — the roster shot needs both.
   */
  paymentStatus: string | null;
  paymentReference?: string;
  checkedIn?: boolean;
};

export type ScreenshotSpeakerSpec = {
  key: string;
  name: string;
  title: string;
  affiliation: string;
  bio: string;
};

export type ScreenshotSessionItemSpec = {
  title: string;
  abstract: string;
  authors: Array<{ name: string; isPresenter?: boolean }>;
};

export type ScreenshotSessionSpec = {
  key: string;
  title: string;
  description: string;
  trackKey: string;
  roomKey?: string;
  /**
   * Offset from the seed's `now`, not a calendar date. CI runs at an arbitrary
   * hour, so anchoring on `now` is the only way to guarantee the same mix
   * every run: finished sessions (feedback opens after end), one in progress,
   * and several still upcoming.
   */
  startsInMinutes: number;
  durationMinutes: number;
  speakerKeys: string[];
  /** Set below the seeded joiner count to photograph "Full — waitlist". */
  inPersonCapacity?: number;
  items?: ScreenshotSessionItemSpec[];
};

export type ScreenshotThreadSpec = {
  key: string;
  channel: "GENERAL" | "MEETUP" | "MOMENTS" | "LOCAL" | "ICEBREAKER";
  title: string;
  body: string;
  authorKey: string;
  createdMinutesAgo: number;
  imageUrls?: string[];
  mapsUrl?: string;
  meetupMode?: "IN_PERSON" | "VIRTUAL";
  meetupStartsInMinutes?: number;
  meetupMeetingUrl?: string;
  meetupInviteEveryone?: boolean;
  /** GENERAL is the only channel with targeting; SESSION needs a session key. */
  audienceType?: "EVERYONE" | "SESSION";
  audienceSessionKey?: string;
  taggedUserKeys?: string[];
  replies?: Array<{ authorKey: string; body: string }>;
};

export type ScreenshotReadinessRequirementSpec = {
  key: string;
  label: string;
  helpText: string;
  kind: string;
  required: boolean;
  dueInDays: number;
};

export type ScreenshotReadinessAssignmentSpec = {
  requirementKey: string;
  speakerKey: string;
  status: "NOT_STARTED" | "IN_PROGRESS" | "SUBMITTED" | "NEEDS_REVIEW" | "READY" | "WAIVED" | "NOT_APPLICABLE";
};

export type ScreenshotProspectSpec = {
  orgName: string;
  contactName: string;
  contactEmail: string;
  websiteUrl: string;
  notes: string;
  status: "TO_CONTACT" | "CONTACTED" | "IN_CONVERSATION" | "CONFIRMED" | "DECLINED";
  lastContactedDaysAgo?: number;
};

export type ScreenshotSeedSpec = {
  org: { name: string; slug: string };
  event: {
    name: string;
    slug: string;
    description: string;
    timezone: string;
    venueName: string;
    venueAddress: string;
    brandColor: string;
    attendeeCap: number;
    paymentPriceText: string;
    paymentUrl: string;
    paymentInstructions: string;
    cfpLabel: string;
    assistantStarters: string[];
  };
  /**
   * Pick-one breakouts rewrites the Agenda into a slot chooser, so it cannot
   * share an event with the card-wall shots (likes, timezone, waitlist). It
   * gets its own one-day event instead of distorting six other captures.
   */
  breakoutEvent: {
    name: string;
    slug: string;
    description: string;
    timezone: string;
    venueName: string;
    attendeeCap: number;
    sessions: ScreenshotSessionSpec[];
  };
  tracks: Array<{ key: string; name: string; color: string }>;
  rooms: Array<{ key: string; name: string; capacity: number }>;
  users: ScreenshotUserSpec[];
  speakers: ScreenshotSpeakerSpec[];
  sessions: ScreenshotSessionSpec[];
  threads: ScreenshotThreadSpec[];
  announcement: { title: string; body: string; postedMinutesAgo: number };
  poll: {
    sessionKey: string;
    question: string;
    options: string[];
    /** Index into `options` per voter, so the bar chart is not a flat tie. */
    votes: Array<{ userKey: string; optionIndex: number }>;
  };
  feedback: Array<{ sessionKey: string; userKey: string; rating: number; comment: string }>;
  qa: Array<{
    sessionKey: string;
    authorKey: string;
    title: string;
    body: string;
    answered: boolean;
    upvoterKeys: string[];
  }>;
  map: {
    name: string;
    pins: Array<{ roomLabel: string; x: number; y: number; roomKey?: string }>;
  };
  sponsors: Array<{
    name: string;
    tier: string;
    url: string;
    description: string;
    boothLabel: string;
    /** Committed PNG beside this file. The wordmark has to match `name`. */
    logoFile: string;
  }>;
  prospects: ScreenshotProspectSpec[];
  outreachTemplate: { name: string; subject: string; body: string };
  cfp: {
    title: string;
    description: string;
    opensInDays: number;
    closesInDays: number;
    customFields: Array<{ id: string; type: string; label: string; required: boolean; options?: string[] }>;
    submission: {
      submitterName: string;
      submitterEmail: string;
      title: string;
      abstract: string;
    };
  };
  readiness: {
    templateName: string;
    templateDescription: string;
    requirements: ScreenshotReadinessRequirementSpec[];
    assignments: ScreenshotReadinessAssignmentSpec[];
  };
  certificate: {
    templateName: string;
    titleText: string;
    bodyText: string;
    hours: number;
    /** Whose certificate the public /verify shot resolves. */
    holderKey: string;
  };
  /**
   * Recap workspace rows written directly — no generate/AI call. Section
   * titles match what RecapPanel shows (kind → "REPORT", "FEEDBACK SYNTHESIS").
   */
  recap: {
    sections: Array<{
      kind: "REPORT" | "FEEDBACK_SYNTHESIS" | "CERTIFICATES";
      title: string;
      bodyMarkdown: string;
    }>;
  };
  matchSuggestions: Array<{ forUserKey: string; suggestedUserKey: string; whyLine: string; draftIntro: string }>;
  notifications: Array<{ forUserKey: string; kind: string; title: string; body: string; minutesAgo: number }>;
  /** Group thread that gives the Messages shot something other than DMs. */
  groupChat: { name: string; memberKeys: string[]; messages: Array<{ authorKey: string; body: string }> };
  directMessage: { memberKeys: string[]; messages: Array<{ authorKey: string; body: string }> };
  /** Awaiting-reply first contact, so the Requests section is not empty. */
  messageRequest: { fromKey: string; toKey: string; body: string };
};

/** The two accounts Playwright signs in as. */
export const SCREENSHOT_ORGANIZER_KEY = "organizer";
export const SCREENSHOT_ATTENDEE_KEY = "priya";

/**
 * A committed PNG next to this file, as a data URL — the storage stub's own
 * shape (`DataUrlStorageProvider.put`), which is what the app serves when no
 * object store is configured. Everything the seed photographs travels this way:
 * no R2 bucket, no network, identical bytes every run.
 *
 * PNG and not SVG on purpose. An SVG data URL with only a viewBox has no
 * intrinsic size, and the sponsor strip's `max-width`/`object-fit` box
 * photographed those as blank space — three tier headings and no logos.
 *
 * `tsx` / vitest resolve `__dirname` next to this file; the compiled `dist/`
 * copy looks one hop back into `src/` if someone runs a built seed.
 */
export function seedImageDataUrl(fileName: string): string {
  const candidates = [
    join(__dirname, fileName),
    join(__dirname, `../../../src/lib/screenshotSeed/${fileName}`),
  ];
  const path = candidates.find((p) => existsSync(p));
  if (!path) {
    throw new Error(`screenshot seed ${fileName} is missing next to fixture.ts`);
  }
  return `data:image/png;base64,${readFileSync(path).toString("base64")}`;
}

/** The Civic Centre floor plan: five labelled rooms at 1200x760. */
export function floorPlanDataUrl(): string {
  return seedImageDataUrl(FLOOR_PLAN_FILE);
}

export const FLOOR_PLAN_FILE = "floorplan.png";

/**
 * Optional event logo. `renderCertificatePdf` puts it above the certificate
 * title and the app shell wears it in the top bar, so dropping a
 * `logo_northbridge.png` in beside the sponsor logos brands both. Absent, both
 * fall back to their unbranded layout — the fixture invents no artwork it does
 * not have.
 */
export function eventLogoDataUrl(): string | null {
  const candidates = [
    join(__dirname, EVENT_LOGO_FILE),
    join(__dirname, `../../../src/lib/screenshotSeed/${EVENT_LOGO_FILE}`),
  ];
  return candidates.some((p) => existsSync(p)) ? seedImageDataUrl(EVENT_LOGO_FILE) : null;
}

export const EVENT_LOGO_FILE = "logo_northbridge.png";

/** A framed placeholder for the Moments photo channel — never a real photo. */
export function momentDataUrl(caption: string): string {
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800">`,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`,
    `<stop offset="0" stop-color="#1f3f7a"/><stop offset="1" stop-color="#2f7f6f"/>`,
    `</linearGradient></defs>`,
    `<rect width="1200" height="800" fill="url(#g)"/>`,
    `<circle cx="980" cy="180" r="90" fill="#ffffff" opacity="0.16"/>`,
    `<rect x="0" y="620" width="1200" height="180" fill="#0b1b33" opacity="0.35"/>`,
    `<text x="70" y="720" fill="#ffffff" font-family="Helvetica, Arial, sans-serif" font-size="48">`,
    caption.replace(/[<>&]/g, ""),
    `</text>`,
    `</svg>`,
  ].join("");
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

/**
 * Every non-retired key turned on, including the ones no preset sets.
 *
 * "Everything on" is not enough: the preset omits cfp, matchmaker,
 * paid_attendance and readiness, and the guide hover cards need all of them
 * photographed. `breakout_style` is deliberately absent — see breakoutEvent.
 */
export function screenshotFeatureOverrides(): Partial<Record<FeatureKey, FeatureOverrideValue>> {
  const overrides: Partial<Record<FeatureKey, FeatureOverrideValue>> = {};
  for (const def of FEATURE_REGISTRY) {
    if (def.retired) continue;
    if (def.key === "breakout_style") continue;
    // No leaderboard surface exists to photograph, and normalizeOverridesForSave
    // forces it off anyway.
    if (def.key === "public_leaderboard") continue;
    overrides[def.key] = true;
  }
  return overrides;
}

export function buildScreenshotSeedSpec(): ScreenshotSeedSpec {
  return {
    org: { name: "Northbridge Conventions", slug: SCREENSHOT_ORG_SLUG },
    event: {
      name: "Northbridge Learning Summit 2026",
      slug: SCREENSHOT_EVENT_SLUG,
      description:
        "Two days of practitioner sessions on assessment, coaching, and curriculum design, hosted by Northbridge Conventions at the Northbridge Civic Centre.",
      timezone: "America/Los_Angeles",
      venueName: "Northbridge Civic Centre",
      venueAddress: "412 Kestrel Street, Northbridge",
      brandColor: "#1f3f7a",
      attendeeCap: 400,
      paymentPriceText: "$180 · $140 for Northbridge members",
      paymentUrl: "https://pay.northbridge-conventions.example/summit-2026",
      paymentInstructions:
        "Purchase orders and cheques are welcome. Email the PO number to registrar@northbridge-conventions.example and we will mark your seat as PO on file.",
      cfpLabel: "Call for Practitioner Sessions",
      assistantStarters: [
        "Where is the Reading Room?",
        "What is on after lunch tomorrow?",
        "Which sessions still have seats?",
      ],
    },
    breakoutEvent: {
      name: "Northbridge PD Day: Choose Your Track",
      slug: SCREENSHOT_BREAKOUT_EVENT_SLUG,
      description:
        "A single-day professional learning day where every participant picks one workshop per block.",
      timezone: "America/Los_Angeles",
      venueName: "Northbridge Civic Centre",
      attendeeCap: 120,
      sessions: [
        {
          key: "pd-block-a-1",
          title: "Block A · Reading conferences that fit in ten minutes",
          description: "A routine a grade-level team can start on Monday.",
          trackKey: "workshops",
          roomKey: "studio2",
          startsInMinutes: 120,
          durationMinutes: 75,
          speakerKeys: ["mara"],
        },
        {
          key: "pd-block-a-2",
          title: "Block A · Small-group maths routines",
          description: "Three routines, one planning template, no new software.",
          trackKey: "workshops",
          roomKey: "studio3",
          startsInMinutes: 120,
          durationMinutes: 75,
          speakerKeys: ["desmond"],
        },
        {
          key: "pd-block-a-3",
          title: "Block A · Feedback students actually read",
          description: "Rewriting comments so they change the next draft.",
          trackKey: "practice",
          roomKey: "reading",
          startsInMinutes: 120,
          durationMinutes: 75,
          speakerKeys: ["ines"],
        },
        {
          key: "pd-block-b-1",
          title: "Block B · Coaching conversations under pressure",
          description: "What to say when the observation did not go well.",
          trackKey: "workshops",
          roomKey: "studio2",
          startsInMinutes: 240,
          durationMinutes: 75,
          speakerKeys: ["desmond"],
        },
        {
          key: "pd-block-b-2",
          title: "Block B · Planning time as infrastructure",
          description: "Protecting the hour that makes everything else work.",
          trackKey: "practice",
          roomKey: "studio3",
          startsInMinutes: 240,
          durationMinutes: 75,
          speakerKeys: ["ines"],
        },
      ],
    },
    tracks: [
      { key: "keynote", name: "Keynotes", color: "#1f3f7a" },
      { key: "workshops", name: "Workshops", color: "#0f6b4c" },
      { key: "practice", name: "Practice showcase", color: "#8a4b08" },
    ],
    rooms: [
      { key: "hall", name: "Northbridge Hall", capacity: 400 },
      { key: "workshopA", name: "Workshop A", capacity: 60 },
      { key: "studio2", name: "Studio 2", capacity: 60 },
      { key: "studio3", name: "Studio 3", capacity: 45 },
      { key: "reading", name: "Reading Room", capacity: 30 },
    ],
    users: [
      {
        key: SCREENSHOT_ORGANIZER_KEY,
        name: "Rosa Lindqvist",
        email: "rosa.lindqvist@northbridge-conventions.example",
        accountRole: "ADMIN",
        eventRole: "ADMIN",
        title: "Programme Director",
        affiliation: "Northbridge Conventions",
        bio: "Runs the Northbridge programme committee and the summit schedule.",
        directoryOptIn: true,
        engagementPoints: 412,
        paymentStatus: "WAIVED",
        paymentReference: "Staff",
        checkedIn: true,
      },
      {
        key: SCREENSHOT_ATTENDEE_KEY,
        name: "Priya Raghunathan",
        email: "priya.raghunathan@ashgrove-schools.example",
        accountRole: "ATTENDEE",
        eventRole: "ATTENDEE",
        title: "Head of Assessment",
        affiliation: "Ashgrove Schools",
        bio: "Working on reporting that families can actually read.",
        researchInterests: "Assessment design, reporting, teacher workload",
        participantType: "Practitioner",
        directoryOptIn: true,
        engagementPoints: 268,
        paymentStatus: "PAID",
        paymentReference: "NB-2026-0148",
        checkedIn: true,
      },
      {
        key: "tomas",
        name: "Tomás Bergqvist",
        email: "tomas.bergqvist@lark-hill.example",
        accountRole: "ATTENDEE",
        eventRole: "ATTENDEE",
        title: "Instructional Coach",
        affiliation: "Lark Hill Academy",
        researchInterests: "Coaching cycles, classroom observation",
        participantType: "Practitioner",
        directoryOptIn: true,
        engagementPoints: 191,
        paymentStatus: "PO_ON_FILE",
        paymentReference: "PO-88214",
        checkedIn: true,
      },
      {
        key: "nadia",
        name: "Nadia Okafor",
        email: "nadia.okafor@brightwater-trust.example",
        accountRole: "ATTENDEE",
        eventRole: "ATTENDEE",
        title: "Curriculum Lead",
        affiliation: "Brightwater Trust",
        researchInterests: "Curriculum mapping, moderation",
        participantType: "Practitioner",
        directoryOptIn: true,
        engagementPoints: 143,
        paymentStatus: "UNPAID",
        checkedIn: false,
      },
      {
        key: "eero",
        name: "Eero Lahtinen",
        email: "eero.lahtinen@northbridge-poly.example",
        accountRole: "ATTENDEE",
        eventRole: "ATTENDEE",
        title: "Lecturer",
        affiliation: "Northbridge Polytechnic",
        researchInterests: "Peer feedback, large cohorts",
        participantType: "Researcher",
        directoryOptIn: true,
        engagementPoints: 96,
        paymentStatus: "PAID",
        paymentReference: "NB-2026-0151",
        checkedIn: true,
      },
      {
        key: "hana",
        name: "Hana Delacroix",
        email: "hana.delacroix@willowmere.example",
        accountRole: "ATTENDEE",
        eventRole: "ATTENDEE",
        title: "Deputy Principal",
        affiliation: "Willowmere College",
        researchInterests: "Timetabling, staff wellbeing",
        participantType: "Leader",
        directoryOptIn: true,
        engagementPoints: 74,
        paymentStatus: "REFUNDED",
        paymentReference: "NB-2026-0132",
        checkedIn: false,
      },
      {
        key: "yusuf",
        name: "Yusuf Adeyemi",
        email: "yusuf.adeyemi@kestrel-street.example",
        accountRole: "ATTENDEE",
        eventRole: "ATTENDEE",
        title: "Numeracy Specialist",
        affiliation: "Kestrel Street Primary",
        researchInterests: "Small-group instruction",
        participantType: "Practitioner",
        directoryOptIn: true,
        engagementPoints: 58,
        paymentStatus: null,
        checkedIn: false,
      },
      {
        key: "marisol",
        name: "Marisol Ferreira",
        email: "marisol.ferreira@northbridge-conventions.example",
        accountRole: "ATTENDEE",
        eventRole: "REVIEWER",
        title: "Programme Committee",
        affiliation: "Northbridge Conventions",
        directoryOptIn: false,
        engagementPoints: 33,
        paymentStatus: "WAIVED",
        paymentReference: "Committee",
        checkedIn: false,
      },
    ],
    speakers: [
      {
        key: "mara",
        name: "Mara Whitfield",
        title: "Literacy Lead",
        affiliation: "Ashgrove Schools",
        bio: "Ran the reading-conference pilot across nine primary schools.",
      },
      {
        key: "desmond",
        name: "Desmond Oyelaran",
        title: "Head of Teaching and Learning",
        affiliation: "Northbridge Academy",
        bio: "Leads the coaching and mentoring programme at Northbridge Academy.",
      },
      {
        key: "ines",
        name: "Inês Carvalho",
        title: "Curriculum Designer",
        affiliation: "Open Learning Collaborative",
        bio: "Designs assessment materials for classroom teams.",
      },
      {
        key: "aleks",
        name: "Aleks Novotný",
        title: "Research Fellow",
        affiliation: "Northbridge Polytechnic",
        bio: "Studies how feedback changes student revision behaviour.",
      },
    ],
    sessions: [
      {
        key: "opening-keynote",
        title: "Opening keynote: Designing a calm conference day",
        description: "How organisers cut noise without cutting energy — what we changed after last year.",
        trackKey: "keynote",
        roomKey: "hall",
        startsInMinutes: -1620,
        durationMinutes: 60,
        speakerKeys: ["mara"],
      },
      {
        key: "reading-conferences",
        title: "Workshop A: Reading conferences in ten minutes",
        description: "Running short one-to-one reading check-ins without losing the rest of the room.",
        trackKey: "workshops",
        roomKey: "studio2",
        startsInMinutes: -1470,
        durationMinutes: 90,
        speakerKeys: ["mara", "ines"],
      },
      {
        key: "moderation-clinic",
        title: "Workshop A: Moderation clinic",
        description: "Bringing three schools' marking to the same standard in one afternoon.",
        trackKey: "workshops",
        roomKey: "studio3",
        startsInMinutes: -1470,
        durationMinutes: 90,
        speakerKeys: ["desmond"],
      },
      {
        key: "practice-showcase",
        title: "Practice showcase: What worked this year",
        description: "Six-minute talks from teams who tried something and measured it.",
        trackKey: "practice",
        roomKey: "reading",
        startsInMinutes: -1290,
        durationMinutes: 90,
        speakerKeys: ["ines", "aleks"],
        items: [
          {
            title: "Ten protected minutes a day",
            abstract: "What changed when one grade-level team fenced off ten minutes for reading conferences.",
            authors: [
              { name: "Mara Whitfield", isPresenter: true },
              { name: "Desmond Oyelaran" },
            ],
          },
          {
            title: "Planning time as infrastructure",
            abstract: "Treating the shared planning hour as a timetable constraint rather than a nice-to-have.",
            authors: [{ name: "Inês Carvalho", isPresenter: true }],
          },
        ],
      },
      {
        key: "feedback-panel",
        title: "Panel: Feedback students actually read",
        description: "Four practitioners on comments that change the next draft.",
        trackKey: "keynote",
        roomKey: "hall",
        startsInMinutes: -45,
        durationMinutes: 75,
        speakerKeys: ["aleks", "ines"],
      },
      {
        key: "coaching-clinic",
        title: "Workshop B: Coaching conversations under pressure",
        description: "What to say when the lesson observation did not go well.",
        trackKey: "workshops",
        roomKey: "studio2",
        startsInMinutes: 120,
        durationMinutes: 90,
        speakerKeys: ["desmond"],
      },
      {
        key: "reporting-lab",
        title: "Workshop B: Reporting families can read",
        description: "Rewriting a report template live, with parents' questions on the wall.",
        trackKey: "workshops",
        roomKey: "reading",
        startsInMinutes: 120,
        durationMinutes: 90,
        speakerKeys: ["ines"],
        // Two seats against four seeded joiners: the agenda card shows
        // "Full — waitlist" and the waitlist keeps real positions.
        inPersonCapacity: 2,
      },
      {
        key: "closing-roundtable",
        title: "Closing roundtable: One change next term",
        description: "Every team leaves with a single commitment written down.",
        trackKey: "keynote",
        roomKey: "hall",
        startsInMinutes: 330,
        durationMinutes: 60,
        speakerKeys: ["mara", "desmond"],
      },
    ],
    threads: [
      {
        key: "general-welcome",
        channel: "GENERAL",
        title: "Bring a power bank — the Hall sockets are on the walls only",
        body: "Learned this the hard way last year. There are sockets down both side walls of Northbridge Hall but almost none in the middle rows, so if you are working from a laptop all morning bring something to top up with.",
        authorKey: "tomas",
        createdMinutesAgo: 300,
        replies: [
          { authorKey: SCREENSHOT_ATTENDEE_KEY, body: "Confirmed — the Studio rooms have sockets under every second table." },
          { authorKey: "nadia", body: "Thank you, packing one now." },
        ],
      },
      {
        key: "general-targeted",
        channel: "GENERAL",
        title: "Panel handout is on the seats, not online",
        body: "For everyone in the feedback panel: the annotated examples are paper-only this year because a few of the samples are student work. Please leave them on the chair when you go.",
        authorKey: SCREENSHOT_ORGANIZER_KEY,
        createdMinutesAgo: 90,
        audienceType: "SESSION",
        audienceSessionKey: "feedback-panel",
      },
      {
        key: "meetup-walk",
        channel: "MEETUP",
        title: "Early walk along the river before day two",
        body: "Meeting at the Kestrel Street entrance at 7:15 for a slow forty-minute loop. No pace expectations, back well before the keynote.",
        authorKey: "hana",
        createdMinutesAgo: 420,
        meetupMode: "IN_PERSON",
        meetupStartsInMinutes: 780,
        meetupInviteEveryone: true,
        replies: [{ authorKey: "eero", body: "In. Is there coffee on that route?" }],
      },
      {
        key: "meetup-virtual",
        channel: "MEETUP",
        title: "Virtual debrief for anyone travelling home tonight",
        body: "If you are on a train during the closing roundtable, I will run a short call afterwards to share what came out of it.",
        authorKey: "nadia",
        createdMinutesAgo: 200,
        meetupMode: "VIRTUAL",
        meetupStartsInMinutes: 600,
        meetupMeetingUrl: "https://meet.northbridge-conventions.example/debrief",
      },
      {
        key: "moments-hall",
        channel: "MOMENTS",
        title: "Northbridge Hall filling up for the keynote",
        body: "Front rows went first this year, which never happens.",
        authorKey: SCREENSHOT_ATTENDEE_KEY,
        createdMinutesAgo: 1500,
        imageUrls: [momentDataUrl("Northbridge Hall, 09:02")],
        taggedUserKeys: ["tomas", "nadia"],
        replies: [{ authorKey: "tomas", body: "Second row, still cannot see the slides. Worth it." }],
      },
      {
        key: "moments-wall",
        channel: "MOMENTS",
        title: "The commitment wall after the showcase",
        body: "Every sticky note is one thing a team is changing next term.",
        authorKey: "eero",
        createdMinutesAgo: 1100,
        imageUrls: [momentDataUrl("Commitment wall, day one")],
      },
      {
        key: "local-lunch",
        channel: "LOCAL",
        title: "Best quick lunch within ten minutes of the Centre",
        body: "The bakery on Kestrel Street does a proper sandwich and you will be back before the afternoon block. Queue looks long but moves fast.",
        authorKey: "yusuf",
        createdMinutesAgo: 640,
        mapsUrl: "https://www.google.com/maps/search/?api=1&query=Kestrel+Street+Northbridge",
        replies: [{ authorKey: "hana", body: "Also a decent tea place two doors down if the bakery is full." }],
      },
      {
        key: "local-parking",
        channel: "LOCAL",
        title: "Parking: the civic car park is cheaper after 09:30",
        body: "Street parking near the venue is two-hour limited and enforced. The civic car park behind the library drops to the day rate at half past nine.",
        authorKey: "tomas",
        createdMinutesAgo: 500,
        mapsUrl: "https://www.google.com/maps/search/?api=1&query=Northbridge+Civic+Car+Park",
      },
      {
        key: "icebreaker-intro",
        channel: "ICEBREAKER",
        title: "One thing you are hoping to stop doing next term",
        body: "Mine is writing three paragraphs of comments that nobody reads. Curious what everyone else is trying to give up.",
        authorKey: "nadia",
        createdMinutesAgo: 820,
        replies: [
          { authorKey: SCREENSHOT_ATTENDEE_KEY, body: "Duplicating the same data into two reporting systems." },
          { authorKey: "yusuf", body: "Marking at the weekend. Genuinely." },
        ],
      },
      {
        key: "icebreaker-first",
        channel: "ICEBREAKER",
        title: "First time at Northbridge — say hello here",
        body: "There are a lot of us who came alone this year. Drop your subject and where you travelled from and find someone to sit with.",
        authorKey: "hana",
        createdMinutesAgo: 900,
        replies: [{ authorKey: "eero", body: "Lecturer, Northbridge Polytechnic, walked here. Happy to save seats." }],
      },
    ],
    announcement: {
      title: "Day two starts in Northbridge Hall, not Studio 2",
      body: "The feedback panel moved to the Hall because the Studio 2 projector is being replaced this morning. Everything after lunch runs in the rooms printed in your programme.",
      postedMinutesAgo: 120,
    },
    poll: {
      sessionKey: "feedback-panel",
      question: "Which feedback change would be hardest to make at your school?",
      options: [
        "Cutting written comments in half",
        "Timetabling feedback into lessons",
        "Getting agreement across a department",
        "Convincing families it is enough",
      ],
      votes: [
        { userKey: SCREENSHOT_ATTENDEE_KEY, optionIndex: 2 },
        { userKey: "tomas", optionIndex: 1 },
        { userKey: "nadia", optionIndex: 2 },
        { userKey: "eero", optionIndex: 0 },
        { userKey: "hana", optionIndex: 2 },
        { userKey: "yusuf", optionIndex: 1 },
      ],
    },
    feedback: [
      {
        sessionKey: "reading-conferences",
        userKey: SCREENSHOT_ATTENDEE_KEY,
        rating: 5,
        comment: "The ten-minute structure is the first version of this I could actually run on Monday without extra staffing.",
      },
      {
        sessionKey: "reading-conferences",
        userKey: "tomas",
        rating: 4,
        comment: "Wanted more on what the other twenty-five children are doing during the conference.",
      },
      {
        sessionKey: "reading-conferences",
        userKey: "nadia",
        rating: 5,
        comment: "Took the planning template straight into our team meeting notes.",
      },
      {
        sessionKey: "opening-keynote",
        userKey: "eero",
        rating: 4,
        comment: "Good framing for the two days. Slides were dense in the middle third.",
      },
    ],
    qa: [
      {
        sessionKey: "feedback-panel",
        authorKey: SCREENSHOT_ATTENDEE_KEY,
        title: "How do you keep comment banks from sounding generic?",
        body: "We tried a shared bank and within a term every report read the same. Did any of the panel find a way to keep it specific?",
        answered: true,
        upvoterKeys: ["tomas", "nadia", "eero", "hana"],
      },
      {
        sessionKey: "feedback-panel",
        authorKey: "yusuf",
        title: "Does this work with thirty-two in a class?",
        body: "Everything shown so far assumes a class of twenty-four or fewer. What breaks first at thirty-two?",
        answered: false,
        upvoterKeys: ["nadia", "hana"],
      },
      {
        sessionKey: "feedback-panel",
        authorKey: "hana",
        title: "What did you stop doing to make room for this?",
        body: "Nobody adds a practice without dropping one. Curious what went.",
        answered: false,
        upvoterKeys: ["tomas"],
      },
    ],
    map: {
      name: "Civic Centre — ground floor",
      pins: [
        // Percentages match the committed floorplan.png room boxes.
        { roomLabel: "Northbridge Hall", x: 26, y: 28, roomKey: "hall" },
        { roomLabel: "Workshop A", x: 60, y: 28, roomKey: "workshopA" },
        { roomLabel: "Reading Room", x: 84, y: 28, roomKey: "reading" },
      ],
    },
    // Named after the committed logo artwork, because the strip shows the
    // wordmark rather than the row's `name` — a sponsor whose logo says
    // something else photographs as a mistake.
    sponsors: [
      {
        name: "Brightwater Trust",
        tier: "Gold",
        url: "https://brightwater-trust.example",
        description: "Funds the moderation clinic across its fourteen schools.",
        boothLabel: "C1",
        logoFile: "logo_brightwater.png",
      },
      {
        name: "Ashgrove Schools",
        tier: "Gold",
        url: "https://ashgrove-schools.example",
        description: "Ran the reading-conference pilot the Workshop A team reports from.",
        boothLabel: "C2",
        logoFile: "logo_ashgrove.png",
      },
      {
        name: "Harbor & Vale Press",
        tier: "Silver",
        url: "https://harbor-vale.example",
        description: "Printed the programme, the room cards, and the commitment wall.",
        boothLabel: "C5",
        logoFile: "logo_harborvale.png",
      },
      {
        name: "Quill Learning Co-op",
        tier: "Community",
        url: "https://quill-learning.example",
        description: "Sponsors the travel bursary for early-career teachers.",
        boothLabel: "C7",
        logoFile: "logo_quill.png",
      },
    ],
    prospects: [
      {
        orgName: "Rivermouth Stationers",
        contactName: "Bea Halloran",
        contactEmail: "bea@rivermouth-stationers.example",
        websiteUrl: "https://rivermouth-stationers.example",
        notes: "Sponsored the regional maths day last spring. Warm intro through Desmond.",
        status: "TO_CONTACT",
      },
      {
        orgName: "Fenwick Educational Travel",
        contactName: "Owen Fenwick",
        contactEmail: "owen@fenwick-travel.example",
        websiteUrl: "https://fenwick-travel.example",
        notes: "Sent the concourse pack. Asked about attendee numbers by region.",
        status: "CONTACTED",
        lastContactedDaysAgo: 6,
      },
      {
        orgName: "Aldergrove Assessment",
        contactName: "Ines Balder",
        contactEmail: "ines.balder@aldergrove-assess.example",
        websiteUrl: "https://aldergrove-assess.example",
        notes: "Second call booked. Wants a workshop slot bundled with the booth — declined, programme is peer-reviewed.",
        status: "IN_CONVERSATION",
        lastContactedDaysAgo: 2,
      },
      {
        orgName: "Quill Learning Co-op",
        contactName: "Salma Reyes",
        contactEmail: "salma.reyes@quill-learning.example",
        websiteUrl: "https://quill-learning.example",
        notes: "Confirmed the travel bursary at the Community tier. Logo received.",
        status: "CONFIRMED",
        lastContactedDaysAgo: 11,
      },
      {
        orgName: "Volt Interactive Displays",
        contactName: "Marek Sowa",
        contactEmail: "marek@volt-displays.example",
        websiteUrl: "https://volt-displays.example",
        notes: "Budget committed elsewhere this year. Try again for the spring institute.",
        status: "DECLINED",
        lastContactedDaysAgo: 19,
      },
    ],
    outreachTemplate: {
      name: "First ask — local supplier",
      subject: "Northbridge Learning Summit 2026 — concourse partner?",
      body: "Hello {{contact}},\n\nI run the programme for the Northbridge Learning Summit, two days of practitioner sessions for about 400 teachers and school leaders at the Civic Centre.\n\nWe have concourse space left and I thought of {{organisation}} because our attendees are exactly the people who specify what you sell. Happy to send the one-page breakdown of tiers.\n\nWould a fifteen-minute call next week suit?\n\nRosa Lindqvist\nProgramme Director, Northbridge Conventions",
    },
    cfp: {
      title: "Call for Practitioner Sessions — Northbridge 2026",
      description:
        "We are looking for sessions led by people doing the work: classroom teachers, coaches, and school leaders. Double-blind review by the Northbridge programme committee.",
      opensInDays: -30,
      closesInDays: 21,
      customFields: [
        { id: "format", type: "select", label: "Session format", required: true, options: ["Workshop", "Short talk", "Panel"] },
        { id: "audience", type: "select", label: "Best suited to", required: true, options: ["Primary", "Secondary", "Both"] },
        { id: "materials", type: "textarea", label: "What will participants take away?", required: true },
      ],
      submission: {
        submitterName: "Aleks Novotný",
        submitterEmail: "aleks.novotny@northbridge-poly.example",
        title: "What students do with feedback when nobody is watching",
        abstract:
          "A two-term study of revision behaviour across four secondary classes, and what happened to redrafting when written comments were cut by half and replaced with a five-minute conference.",
      },
    },
    readiness: {
      templateName: "Workshop presenter",
      templateDescription: "What every accepted workshop presenter owes us before the programme goes to print.",
      requirements: [
        {
          key: "bio",
          label: "Speaker bio (60 words)",
          helpText: "Printed in the programme and shown on your session page.",
          kind: "long_text",
          required: true,
          dueInDays: -4,
        },
        {
          key: "slides",
          label: "Slides or a link to them",
          helpText: "Upload a file or paste a link. We do not need the final version, just what you will present from.",
          kind: "file",
          required: true,
          dueInDays: 3,
        },
        {
          key: "av",
          label: "Room and AV needs",
          helpText: "Tell us if you need anything beyond a projector and a handheld mic.",
          kind: "short_text",
          required: true,
          dueInDays: 5,
        },
        {
          key: "agreement",
          label: "Recording and photography agreement",
          helpText: "Confirm whether we may record your session and photograph the room.",
          kind: "agreement",
          required: true,
          dueInDays: 5,
        },
        {
          key: "handout",
          label: "Handout for the concourse table",
          helpText: "Optional. If you send one by the deadline we print it.",
          kind: "file",
          required: false,
          dueInDays: 8,
        },
      ],
      // Deliberately every state the Readiness board can render, so the shot
      // shows a real mix instead of a column of NOT_STARTED.
      assignments: [
        { requirementKey: "bio", speakerKey: "mara", status: "READY" },
        { requirementKey: "bio", speakerKey: "desmond", status: "READY" },
        { requirementKey: "bio", speakerKey: "ines", status: "SUBMITTED" },
        { requirementKey: "bio", speakerKey: "aleks", status: "NOT_STARTED" },
        { requirementKey: "slides", speakerKey: "mara", status: "READY" },
        { requirementKey: "slides", speakerKey: "desmond", status: "NEEDS_REVIEW" },
        { requirementKey: "slides", speakerKey: "ines", status: "IN_PROGRESS" },
        { requirementKey: "slides", speakerKey: "aleks", status: "NOT_STARTED" },
        { requirementKey: "av", speakerKey: "mara", status: "READY" },
        { requirementKey: "av", speakerKey: "desmond", status: "SUBMITTED" },
        { requirementKey: "av", speakerKey: "ines", status: "NOT_STARTED" },
        { requirementKey: "av", speakerKey: "aleks", status: "IN_PROGRESS" },
        { requirementKey: "agreement", speakerKey: "mara", status: "READY" },
        { requirementKey: "agreement", speakerKey: "desmond", status: "READY" },
        { requirementKey: "agreement", speakerKey: "ines", status: "NOT_STARTED" },
        { requirementKey: "agreement", speakerKey: "aleks", status: "WAIVED" },
        { requirementKey: "handout", speakerKey: "mara", status: "NOT_APPLICABLE" },
        { requirementKey: "handout", speakerKey: "desmond", status: "NOT_STARTED" },
        { requirementKey: "handout", speakerKey: "ines", status: "SUBMITTED" },
        { requirementKey: "handout", speakerKey: "aleks", status: "NOT_APPLICABLE" },
      ],
    },
    certificate: {
      templateName: "Summit attendance — 12 hours",
      titleText: "Certificate of Attendance",
      bodyText:
        "attended the Northbridge Learning Summit 2026, two days of practitioner professional learning on assessment, coaching, and curriculum design.",
      hours: 12,
      holderKey: SCREENSHOT_ATTENDEE_KEY,
    },
    recap: {
      sections: [
        {
          kind: "REPORT",
          title: "Northbridge Learning Summit 2026 — Recap report",
          bodyMarkdown: [
            "# Northbridge Learning Summit 2026",
            "",
            "Two days at the Civic Centre. The Hall filled for the opening keynote, Workshop A ran back-to-back on reading conferences, and the reporting lab waitlist was the only room that went over.",
            "",
            "Check-ins tracked against the roster; Q&A and the commitment wall were the busiest attendee surfaces. Numbers in the metrics snapshot are from SQL, not this draft.",
          ].join("\n"),
        },
        {
          kind: "FEEDBACK_SYNTHESIS",
          title: "Northbridge Learning Summit 2026 — Feedback synthesis",
          bodyMarkdown: [
            "# Feedback synthesis",
            "",
            "## Comments people can use on Monday",
            "> The ten-minute structure is the first version of this I could actually run on Monday without extra staffing.",
            "",
            "## What to protect next year",
            "- Keep the Hall sockets note in the welcome thread.",
            "- Do not move the feedback panel out of the Hall on the morning.",
          ].join("\n"),
        },
        {
          kind: "CERTIFICATES",
          title: "Northbridge Learning Summit 2026 — Certificates",
          bodyMarkdown: [
            "# Certificates",
            "",
            "Template ready: Summit attendance — 12 hours. Eligibility is any check-in. Batch issue stays a separate click after the event ends.",
          ].join("\n"),
        },
      ],
    },
    matchSuggestions: [
      {
        forUserKey: SCREENSHOT_ATTENDEE_KEY,
        suggestedUserKey: "eero",
        whyLine: "Both working on peer feedback at scale — you across a district, Eero across large lecture cohorts.",
        draftIntro:
          "Hi Eero — I saw we are both trying to make peer feedback work with big numbers. I am at Ashgrove doing this across nine schools. Would you have twenty minutes between sessions tomorrow?",
      },
      {
        forUserKey: SCREENSHOT_ATTENDEE_KEY,
        suggestedUserKey: "nadia",
        whyLine: "Nadia is rebuilding moderation across a trust; you are rebuilding reporting. Same fight, different end.",
        draftIntro:
          "Hi Nadia — moderation and reporting keep landing on the same table for us. I would like to hear how you are handling it across the trust.",
      },
      {
        forUserKey: SCREENSHOT_ATTENDEE_KEY,
        suggestedUserKey: "tomas",
        whyLine: "Tomás runs coaching cycles that end in the reporting conversation you are redesigning.",
        draftIntro:
          "Hi Tomás — your coaching cycles seem to end exactly where my reporting work starts. Coffee before the closing roundtable?",
      },
    ],
    notifications: [
      {
        forUserKey: SCREENSHOT_ATTENDEE_KEY,
        kind: "ANNOUNCEMENT",
        title: "Day two starts in Northbridge Hall, not Studio 2",
        body: "The feedback panel moved because the Studio 2 projector is being replaced.",
        minutesAgo: 120,
      },
      {
        forUserKey: SCREENSHOT_ATTENDEE_KEY,
        kind: "COMMUNITY_REPLY",
        title: "Tomás Bergqvist replied to your Moments post",
        body: "Second row, still cannot see the slides. Worth it.",
        minutesAgo: 240,
      },
      {
        forUserKey: SCREENSHOT_ATTENDEE_KEY,
        kind: "SESSION_STARTING_SOON",
        title: "Panel: Feedback students actually read starts soon",
        body: "Northbridge Hall, in 15 minutes.",
        minutesAgo: 60,
      },
      {
        forUserKey: SCREENSHOT_ATTENDEE_KEY,
        kind: "DIGEST_ROLLUP",
        title: "Yesterday at Northbridge: 6 new posts, 2 meet-ups",
        body: "Two meet-ups were proposed and the commitment wall filled up. Nothing needed you overnight.",
        minutesAgo: 480,
      },
      {
        forUserKey: SCREENSHOT_ATTENDEE_KEY,
        kind: "COMMUNITY_THREAD",
        title: "Hana Delacroix proposed an early river walk",
        body: "Meeting at the Kestrel Street entrance at 7:15.",
        minutesAgo: 420,
      },
    ],
    groupChat: {
      name: "Ashgrove travel group",
      memberKeys: [SCREENSHOT_ATTENDEE_KEY, "tomas", "nadia"],
      messages: [
        { authorKey: "tomas", body: "Train at 6:40 tomorrow — platform 3, not 1 like last time." },
        { authorKey: SCREENSHOT_ATTENDEE_KEY, body: "Noted. I have the panel handouts, so do not wait for me at the barrier." },
        { authorKey: "nadia", body: "I will grab coffees on the platform. Same order as today?" },
      ],
    },
    directMessage: {
      memberKeys: [SCREENSHOT_ATTENDEE_KEY, "eero"],
      messages: [
        { authorKey: "eero", body: "Your question in the panel about generic comment banks — we hit exactly that. Happy to compare notes." },
        { authorKey: SCREENSHOT_ATTENDEE_KEY, body: "Yes please. Are you around after the closing roundtable?" },
        { authorKey: "eero", body: "I am. Reading Room is usually quiet by then." },
      ],
    },
    messageRequest: {
      fromKey: "yusuf",
      toKey: SCREENSHOT_ATTENDEE_KEY,
      body: "Hello — you mentioned a reporting template in the showcase queue. Would you mind sharing what you settled on?",
    },
  };
}
