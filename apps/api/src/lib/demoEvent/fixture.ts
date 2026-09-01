/**
 * Shared fixture definition for the public demo event and sample-event clones.
 */

import { brand } from "@event-app/config";

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
  }>;
  sponsors: Array<{
    name: string;
    tier: string;
    url: string;
    description: string;
    sortOrder: number;
  }>;
  sessions: Array<{
    title: string;
    description: string;
    trackIndex: number;
    /** Index into rooms; omit for no room. */
    roomIndex?: number;
    /** Minutes from 09:00 on dayOffset. */
    dayOffset: number;
    startMinute: number;
    durationMinutes: number;
    speakerKeys: string[];
    items?: Array<{
      title: string;
      abstract: string;
      authors: Array<{ name: string; isPresenter?: boolean }>;
    }>;
  }>;
};

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
        bio: "Leads professional learning at a K-12 school.",
      },
      {
        key: "jonas",
        name: "Jonas Okonkwo",
        title: "Head of Teaching and Learning",
        affiliation: "Northbridge Academy",
        bio: "Runs the school's coaching and mentoring program.",
      },
      {
        key: "elena",
        name: "Elena Ruiz",
        title: "Curriculum Lead",
        affiliation: "Open Learning Collaborative",
        bio: "Designs training materials for classroom teams.",
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
        roomIndex: 0,
        dayOffset: 0,
        startMinute: 0,
        durationMinutes: 60,
        speakerKeys: ["maya"],
      },
      {
        title: "Workshop block A: Reading conferences",
        description: "Running short one-to-one reading check-ins without losing the room.",
        trackIndex: 1,
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
        roomIndex: 3,
        dayOffset: 0,
        startMinute: 240,
        durationMinutes: 90,
        speakerKeys: ["jonas", "elena"],
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
        title: "Workshop block B: Feedback students actually use",
        description: "Hands-on session on written and spoken feedback.",
        trackIndex: 1,
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
        roomIndex: 0,
        dayOffset: 1,
        startMinute: 120,
        durationMinutes: 60,
        speakerKeys: ["maya", "jonas"],
      },
    ],
  };
}
