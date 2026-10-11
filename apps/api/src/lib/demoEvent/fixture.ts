/**
 * Shared fixture definition for the public demo event and sample-event clones.
 */

import { brand } from "@event-app/config";
import type { SessionFormat } from "@event-app/shared";

export type DemoFixtureMode = "public_demo" | "sample_draft";

/** Two-day institute — the shape most organizers arriving at the demo run. */
const DEMO_EVENT_DAYS = 2;

export type DemoFixtureSpec = {
  name: string;
  slug: string;
  description: string;
  timezone: string;
  venueName: string;
  venueAddress: string;
  /** Relative day offsets from a stable "conference Monday". */
  startOffsetDays: number;
  endOffsetDays: number;
  tracks: Array<{ name: string; color?: string }>;
  rooms: Array<{ name: string; capacity?: number }>;
  speakers: Array<{
    key: string;
    name: string;
    title: string;
    affiliation: string;
    bio: string;
    /**
     * AGENDA-1 — the session peek shows a speaker's face. Served from the web
     * app's public folder so the demo needs no uploads and no external host.
     */
    photoUrl?: string;
  }>;
  sponsors: Array<{
    name: string;
    tier: string;
    url: string;
    description: string;
    sortOrder: number;
  }>;
  /**
   * PRESENTER-HOME-B — 14 directory-visible people on Maya's keynote, each
   * with a one-line bio. Portraits stay on the original three. reset.ts copies
   * these fields through the existing user upsert.
   */
  rosterJoiners: Array<{
    name: string;
    email: string;
    title: string;
    affiliation: string;
    bio: string;
    photoUrl?: string;
  }>;
  /** Two JOINING people who keep their directory profile private. */
  rosterPrivate: Array<{
    name: string;
    email: string;
    title: string;
    affiliation: string;
    bio: string;
  }>;
  sessions: Array<{
    title: string;
    description: string;
    trackIndex: number;
    /**
     * AGENDA-2 — one of SESSION_FORMATS. Set on every demo session so the
     * public demo actually shows the format filter; an event that leaves them
     * all null hides the section, which is right but demos nothing.
     */
    format: SessionFormat;
    /** Index into rooms; omit for no room. */
    roomIndex?: number;
    /** Minutes from 09:00 on dayOffset. */
    dayOffset: number;
    startMinute: number;
    durationMinutes: number;
    speakerKeys: string[];
    /** Slide deck / handout, so the peek's materials row has something to show. */
    fileUrl?: string;
    items?: Array<{
      title: string;
      abstract: string;
      authors: Array<{ name: string; isPresenter?: boolean }>;
    }>;
  }>;
};

/**
 * Named joiners on Maya's opening keynote. The first three keep the demo
 * portraits. Everyone else is initials. Each bio is one line.
 */
export const DEMO_ROSTER_JOINERS = [
  {
    name: "Priya Shah",
    email: "priya.shah@demo.readyhall.com",
    title: "Grade 4 teacher",
    affiliation: "Riverside School District",
    bio: "Plans the morning block so reading is not the thing that gets squeezed.",
    photoUrl: "/demo/speakers/priya-shah.svg",
  },
  {
    name: "Sam Ortiz",
    email: "sam.ortiz@demo.readyhall.com",
    title: "Literacy specialist",
    affiliation: "Open Learning Collaborative",
    bio: "Sits with grade-level teams while they choose what to stop assigning.",
    photoUrl: "/demo/speakers/sam-ortiz.svg",
  },
  {
    name: "Tom Hale",
    email: "tom.hale@demo.readyhall.com",
    title: "Math coach",
    affiliation: "Northbridge Academy",
    bio: "Watches how a problem is launched, not how many problems get finished.",
    photoUrl: "/demo/speakers/tom-hale.svg",
  },
  {
    name: "Amina Farah",
    email: "amina.farah@demo.readyhall.com",
    title: "Science lead",
    affiliation: "Riverside School District",
    bio: "Keeps lab days short enough that the discussion still fits.",
  },
  {
    name: "Ben Cho",
    email: "ben.cho@demo.readyhall.com",
    title: "Grade 2 teacher",
    affiliation: "Harbor Elementary",
    bio: "Protects the first twenty minutes for reading aloud.",
  },
  {
    name: "Carmen Diaz",
    email: "carmen.diaz@demo.readyhall.com",
    title: "Assistant principal",
    affiliation: "Northbridge Academy",
    bio: "Looks at the master schedule for meetings that could be a note.",
  },
  {
    name: "David Okoye",
    email: "david.okoye@demo.readyhall.com",
    title: "Counselor",
    affiliation: "Open Learning Collaborative",
    bio: "Asks which part of the day students actually get a quiet stretch.",
  },
  {
    name: "Fatima Noor",
    email: "fatima.noor@demo.readyhall.com",
    title: "Librarian",
    affiliation: "Harbor Elementary",
    bio: "Runs the library as a place to finish a book, not a rotation.",
  },
  {
    name: "Greg Walsh",
    email: "greg.walsh@demo.readyhall.com",
    title: "PE teacher",
    affiliation: "Riverside School District",
    bio: "Treats outdoor time as part of the day, not a reward.",
  },
  {
    name: "Hannah Brooks",
    email: "hannah.brooks@demo.readyhall.com",
    title: "Grade 6 teacher",
    affiliation: "Westfield Middle School",
    bio: "Cuts the warm-up when the lesson is the thing that matters.",
  },
  {
    name: "Ivan Petrov",
    email: "ivan.petrov@demo.readyhall.com",
    title: "Instructional aide",
    affiliation: "Westfield Middle School",
    bio: "Stays with one group instead of circulating the whole period.",
  },
  {
    name: "Julia Nguyen",
    email: "julia.nguyen@demo.readyhall.com",
    title: "Reading specialist",
    affiliation: "Harbor Elementary",
    bio: "Pulls small groups only after the whole class has started reading.",
  },
  {
    name: "Kenji Mori",
    email: "kenji.mori@demo.readyhall.com",
    title: "Grade 5 teacher",
    affiliation: "Northbridge Academy",
    bio: "Ends the day with one question, not a packet.",
  },
  {
    name: "Lila Grant",
    email: "lila.grant@demo.readyhall.com",
    title: "Special education teacher",
    affiliation: "Open Learning Collaborative",
    bio: "Writes the accommodation into the lesson instead of beside it.",
  },
] as const;

/**
 * DEMO-EXPLORERS-1 — shareable attendee logins. Not part of DEMO_ROSTER_JOINERS,
 * so they do not change the "14 names shown" fixture count. reset.ts creates
 * them only when DEMO_EXPLORER_PASSWORD is set.
 */
export const DEMO_EXPLORERS = [
  {
    email: "explorer.one@demo.readyhall.com",
    name: "Explorer One",
    title: "Visitor",
    affiliation: "Readyhall demo",
  },
  {
    email: "explorer.two@demo.readyhall.com",
    name: "Explorer Two",
    title: "Visitor",
    affiliation: "Readyhall demo",
  },
] as const;

/** JOINING attendees who stay out of the directory. Counted, not named. */
export const DEMO_ROSTER_PRIVATE = [
  {
    name: "Jordan Ellis",
    email: "hidden.joiner@demo.readyhall.com",
    title: "Visitor",
    affiliation: "Visitor",
    bio: "Joined the keynote and keeps a directory profile private.",
  },
  {
    name: "Quinn Adler",
    email: "quinn.adler@demo.readyhall.com",
    title: "Guest",
    affiliation: "Guest",
    bio: "Joined the keynote without opting into the attendee directory.",
  },
] as const;

/** One note already on the keynote so the presenter page lists it. */
export const DEMO_PRESENTER_NOTE =
  "I'll start with one part of the day worth protecting, then leave time for the room.";

/** Anchor: next Monday-ish from a fixed epoch so resets stay stable within a week. */
export function demoConferenceWindow(now = new Date()): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 14, 0, 0));
  // Align to upcoming Monday (UTC)
  const day = start.getUTCDay();
  const add = day === 1 ? 0 : (8 - day) % 7;
  start.setUTCDate(start.getUTCDate() + add);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + DEMO_EVENT_DAYS - 1);
  end.setUTCHours(21, 0, 0, 0);
  return { start, end };
}

export function buildDemoFixtureSpec(mode: DemoFixtureMode): DemoFixtureSpec {
  const isDemo = mode === "public_demo";
  return {
    // Public demo copy — hosted-by is brand.internalOrgName ("Readyhall"),
    // applied on org create in reset.ts. Live demo row is edited by hand.
    name: isDemo ? `${brand.productName} Public Demo` : "Sample Teaching & Learning Institute",
    slug: isDemo ? brand.demoEventSlug : `sample-${Date.now().toString(36)}`,
    description: isDemo
      ? `A read-only demo of ${brand.productName}: a two-day teaching and learning institute with sessions, speakers, and sponsors. Sign up to create your own event.`
      : `A private DRAFT sample event to explore ${brand.productName}. Edit freely — it counts toward your plan's event limit.`,
    timezone: "America/Los_Angeles",
    venueName: "Riverside Learning Center",
    venueAddress: "220 Riverside Avenue, Example City, CA",
    startOffsetDays: 0,
    endOffsetDays: DEMO_EVENT_DAYS - 1,
    rosterJoiners: [...DEMO_ROSTER_JOINERS],
    rosterPrivate: [...DEMO_ROSTER_PRIVATE],
    tracks: [
      { name: "Leadership", color: "#0033A0" },
      { name: "Classroom practice", color: "#0F6B4C" },
      { name: "Student support", color: "#8A4B08" },
    ],
    // Realistic rooms so the By-room schedule view demonstrates itself on the
    // flagship demo instead of grouping everything under "No room".
    rooms: [
      { name: "Hall A", capacity: 400 },
      { name: "Room 12", capacity: 60 },
      { name: "Room 14", capacity: 40 },
      { name: "Library", capacity: 80 },
    ],
    speakers: [
      {
        key: "maya",
        name: "Maya Chen",
        title: "Instructional Coach",
        affiliation: "Riverside School District",
        bio: "Leads professional learning at a K-12 school. She works with grade-level teams on the shape of the day: what to protect, what to quiet, and how a staff learns a change without a new program every term. Her sessions are built from classrooms she still visits, and from the questions teachers ask when the plan meets a real Tuesday morning.",
        photoUrl: "/demo/speakers/maya-chen.svg",
      },
      {
        key: "jonas",
        name: "Jonas Okonkwo",
        title: "Head of Teaching and Learning",
        affiliation: "Northbridge Academy",
        bio: "Runs the school's coaching and mentoring program.",
        photoUrl: "/demo/speakers/jonas-okonkwo.svg",
      },
      {
        key: "elena",
        name: "Elena Ruiz",
        title: "Curriculum Lead",
        affiliation: "Open Learning Collaborative",
        bio: "Designs training materials for classroom teams.",
        photoUrl: "/demo/speakers/elena-ruiz.svg",
      },
    ],
    sponsors: [
      {
        name: "Riverside Books",
        tier: "Gold",
        url: "https://example.com/riverside-books",
        description: "Classroom library partner.",
        sortOrder: 0,
      },
      {
        name: "Bright Path Learning",
        tier: "Silver",
        url: "https://example.com/bright-path",
        description: "Teaching resources and training software.",
        sortOrder: 1,
      },
    ],
    sessions: [
      {
        title: "Opening keynote: Designing calm learning days",
        description: "How organizers reduce noise without losing energy.",
        trackIndex: 0,
        format: "keynote",
        roomIndex: 0,
        dayOffset: 0,
        startMinute: 0,
        durationMinutes: 60,
        speakerKeys: ["maya"],
        items: [
          {
            title: "What a calm learning day actually protects",
            abstract:
              "Which parts of the school day can go quiet without losing the energy of the room, and what a staff has to keep.",
            authors: [
              { name: "Maya Chen", isPresenter: true },
              { name: "Jonas Okonkwo" },
            ],
          },
        ],
      },
      {
        title: "Coffee and registration",
        description: "Badges, coffee, and a chance to find your first session.",
        trackIndex: 0,
        format: "break",
        roomIndex: 0,
        dayOffset: 0,
        startMinute: 60,
        durationMinutes: 30,
        speakerKeys: [],
      },
      {
        title: "Workshop block A: Reading conferences",
        description: "Running short one-to-one reading check-ins without losing the room.",
        trackIndex: 1,
        format: "workshop",
        roomIndex: 1,
        dayOffset: 0,
        startMinute: 90,
        durationMinutes: 90,
        speakerKeys: ["elena"],
      },
      {
        title: "Workshop block A: Small-group math routines",
        description: "Routines a grade-level team can start on Monday.",
        trackIndex: 1,
        format: "workshop",
        roomIndex: 2,
        dayOffset: 0,
        startMinute: 90,
        durationMinutes: 90,
        speakerKeys: ["jonas"],
      },
      {
        title: "Practice showcase: What worked this year",
        description: "Short talks from teams trying something new.",
        trackIndex: 2,
        format: "lightning",
        roomIndex: 3,
        dayOffset: 0,
        startMinute: 240,
        durationMinutes: 90,
        speakerKeys: ["jonas", "elena"],
        fileUrl: "/demo/materials/practice-showcase-slides.pdf",
        items: [
          {
            title: "Ten minutes of reading conferences, every day",
            abstract: "What changed when one grade-level team protected ten minutes a day.",
            authors: [
              { name: "Aisha Rahman", isPresenter: true },
              { name: "Jonas Okonkwo" },
            ],
          },
          {
            title: "Planning time as infrastructure",
            abstract: "When protected planning time becomes the real professional learning.",
            authors: [{ name: "Elena Ruiz", isPresenter: true }],
          },
        ],
      },
      {
        title: "Evening reception",
        description: "Food, drinks, and the conversations the day started.",
        trackIndex: 2,
        format: "social",
        roomIndex: 3,
        dayOffset: 0,
        startMinute: 390,
        durationMinutes: 90,
        speakerKeys: [],
      },
      {
        title: "Workshop block B: Feedback students actually use",
        description: "Hands-on session on written and spoken feedback.",
        trackIndex: 1,
        format: "workshop",
        roomIndex: 1,
        dayOffset: 1,
        startMinute: 30,
        durationMinutes: 75,
        speakerKeys: ["elena"],
      },
      {
        title: "Closing roundtable: What we will change next term",
        description: "Each team leaves with one commitment.",
        trackIndex: 0,
        format: "panel",
        roomIndex: 0,
        dayOffset: 1,
        startMinute: 120,
        durationMinutes: 60,
        speakerKeys: ["maya", "jonas"],
      },
      // PRESENTER-HOME-C — share Maya's keynote vocabulary so "Sessions like yours" has rows.
      {
        title: "Keeping a calm learning block",
        description: "How a staff protects quiet energy without adding another program.",
        trackIndex: 0,
        format: "talk",
        roomIndex: 1,
        dayOffset: 0,
        startMinute: 200,
        durationMinutes: 30,
        speakerKeys: ["elena"],
      },
      {
        title: "What quiet time protects",
        description: "A staff learns which parts of learning can stay calm.",
        trackIndex: 0,
        format: "workshop",
        roomIndex: 2,
        dayOffset: 0,
        startMinute: 340,
        durationMinutes: 40,
        speakerKeys: ["jonas"],
      },
      {
        title: "Energy after a quiet morning",
        description: "Protect the calm a learning day needs, then decide what the staff keeps.",
        trackIndex: 0,
        format: "panel",
        roomIndex: 3,
        dayOffset: 1,
        startMinute: 0,
        durationMinutes: 25,
        speakerKeys: ["elena"],
      },
      {
        title: "Staff energy when learning goes quiet",
        description: "Protect the calm in the room while the staff keeps its energy.",
        trackIndex: 0,
        format: "workshop",
        roomIndex: 1,
        dayOffset: 1,
        startMinute: 100,
        durationMinutes: 50,
        speakerKeys: ["elena"],
      },
    ],
  };
}
