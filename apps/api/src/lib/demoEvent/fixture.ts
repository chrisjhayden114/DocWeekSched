/**
 * Shared fixture definition for the public demo event and sample-event clones.
 */

import { brand } from "@event-app/config";

export type DemoFixtureMode = "public_demo" | "sample_draft";

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
  end.setUTCDate(end.getUTCDate() + 2);
  end.setUTCHours(21, 0, 0, 0);
  return { start, end };
}

export function buildDemoFixtureSpec(mode: DemoFixtureMode): DemoFixtureSpec {
  const isDemo = mode === "public_demo";
  return {
    name: isDemo ? `${brand.productName} Public Demo` : "Sample Academic Conference",
    slug: isDemo ? brand.demoEventSlug : `sample-${Date.now().toString(36)}`,
    description: isDemo
      ? `A read-only demo of ${brand.productName}: sessions, papers, speakers, and sponsors. Sign up to create your own event.`
      : `A private DRAFT sample event to explore ${brand.productName}. Edit freely — it counts toward your plan's event limit.`,
    timezone: "America/Los_Angeles",
    venueName: "University Conference Center",
    venueAddress: "100 Campus Drive, Example City, CA",
    startOffsetDays: 0,
    endOffsetDays: 2,
    tracks: [
      { name: "Plenary", color: "#0033A0" },
      { name: "Research", color: "#0F6B4C" },
      { name: "Practice", color: "#8A4B08" },
    ],
    speakers: [
      {
        key: "maya",
        name: "Dr. Maya Chen",
        title: "Associate Professor",
        affiliation: "Westbrook University",
        bio: "Studies doctoral mentoring and program design.",
      },
      {
        key: "jonas",
        name: "Jonas Okonkwo",
        title: "Director of Graduate Studies",
        affiliation: "Northbridge College",
        bio: "Leads cohort-based professional doctorates.",
      },
      {
        key: "elena",
        name: "Elena Ruiz",
        title: "Research Fellow",
        affiliation: "Open Methods Lab",
        bio: "Works on open scholarship and research infrastructure.",
      },
    ],
    sponsors: [
      {
        name: "Campus Press",
        tier: "Gold",
        url: "https://example.com/campus-press",
        description: "Academic publishing partner.",
        sortOrder: 0,
      },
      {
        name: "Scholar Tools Co.",
        tier: "Silver",
        url: "https://example.com/scholar-tools",
        description: "Research workflow software.",
        sortOrder: 1,
      },
    ],
    sessions: [
      {
        title: "Opening keynote: Designing calm conferences",
        description: "How organizers reduce noise without losing energy.",
        trackIndex: 0,
        dayOffset: 0,
        startMinute: 0,
        durationMinutes: 60,
        speakerKeys: ["maya"],
      },
      {
        title: "Paper session: Mentoring networks",
        description: "Short papers on peer mentoring in doctoral programs.",
        trackIndex: 1,
        dayOffset: 0,
        startMinute: 90,
        durationMinutes: 90,
        speakerKeys: ["jonas", "elena"],
        items: [
          {
            title: "Weak ties that stick: cohort messaging norms",
            abstract: "A qualitative study of messaging norms across three cohorts.",
            authors: [
              { name: "Aisha Rahman", isPresenter: true },
              { name: "Jonas Okonkwo" },
            ],
          },
          {
            title: "Office hours as infrastructure",
            abstract: "When unstructured time becomes the real curriculum.",
            authors: [{ name: "Elena Ruiz", isPresenter: true }],
          },
        ],
      },
      {
        title: "Workshop: Importing your program in minutes",
        description: "Hands-on walkthrough of agenda ingest patterns.",
        trackIndex: 2,
        dayOffset: 1,
        startMinute: 30,
        durationMinutes: 75,
        speakerKeys: ["elena"],
      },
      {
        title: "Closing roundtable",
        description: "What we will change next year.",
        trackIndex: 0,
        dayOffset: 2,
        startMinute: 120,
        durationMinutes: 60,
        speakerKeys: ["maya", "jonas"],
      },
    ],
  };
}
