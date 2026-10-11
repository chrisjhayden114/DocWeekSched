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
   * PRESENTER-HOME-A — directory-visible people on Maya's keynote.
   * Titles, affiliations, and portraits live here; reset.ts copies them onto
   * the existing joiner rows and does not change who joins or who is hidden.
   */
  rosterJoiners: Array<{
    name: string;
    title: string;
    affiliation: string;
    photoUrl: string;
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
 * The three named joiners on Maya's opening keynote. Portraits are the same
 * flat style as the speaker SVGs under apps/web/public/demo/speakers/.
 */
export const DEMO_ROSTER_JOINERS = [
  {
    name: "Priya Shah",
    title: "Grade 4 teacher",
    affiliation: "Riverside School District",
    photoUrl: "/demo/speakers/priya-shah.svg",
  },
  {
    name: "Sam Ortiz",
    title: "Literacy specialist",
    affiliation: "Open Learning Collaborative",
    photoUrl: "/demo/speakers/sam-ortiz.svg",
  },
  {
    name: "Tom Hale",
    title: "Math coach",
    affiliation: "Northbridge Academy",
    photoUrl: "/demo/speakers/tom-hale.svg",
  },
] as const;

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
    tracks: [
      { name: "Keynote", color: "#0033A0" },
      { name: "Workshops", color: "#0F6B4C" },
      { name: "Practice", color: "#8A4B08" },
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
    ],
  };
}
