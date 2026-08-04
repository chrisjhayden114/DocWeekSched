/**
 * E19.1 fixture — FIVE concurrent sessions, not two.
 *
 * A realistic five-track conference time slot (squarely inside the stated
 * 50–2,000 attendee target band): five sessions in five rooms/tracks sharing
 * the same 9:00–10:15 slot, with long titles like real programmes have,
 * plus one solo session later the same day to prove solo blocks keep full
 * column width.
 */

import type { TimetableSession } from "../../lib/scheduleLayout";

export const FIVE_CONCURRENT_SESSIONS: TimetableSession[] = [
  {
    id: "s1",
    title: "Research Design Workshop — PhD Cohort Methodology Intensive",
    startsAt: "2026-06-08T09:00:00-04:00",
    endsAt: "2026-06-08T10:15:00-04:00",
    roomKey: "hall-a",
    roomLabel: "Hall A",
    trackId: "t1",
    trackName: "PhD",
  },
  {
    id: "s2",
    title: "Technology Toolkit: AI-Assisted Literature Reviews in Practice",
    startsAt: "2026-06-08T09:00:00-04:00",
    endsAt: "2026-06-08T10:15:00-04:00",
    roomKey: "room-214",
    roomLabel: "Room 214",
    trackId: "t2",
    trackName: "EdD",
  },
  {
    id: "s3",
    title: "Hot Topics & Trends in Doctoral Education Policy and Funding",
    startsAt: "2026-06-08T09:00:00-04:00",
    endsAt: "2026-06-08T10:15:00-04:00",
    roomKey: "room-108",
    roomLabel: "Room 108",
    trackId: "t3",
    trackName: "Faculty",
  },
  {
    id: "s4",
    title: "Masterclass: Writing the Dissertation Proposal That Gets Approved",
    startsAt: "2026-06-08T09:00:00-04:00",
    endsAt: "2026-06-08T10:15:00-04:00",
    roomKey: "gallery",
    roomLabel: "Gallery",
    trackId: "t4",
    trackName: "Writing",
  },
  {
    id: "s5",
    title: "Program Updates and Open Q&A with the Doctoral Studies Office",
    startsAt: "2026-06-08T09:00:00-04:00",
    endsAt: "2026-06-08T10:15:00-04:00",
    roomKey: "hall-b",
    roomLabel: "Hall B",
    trackId: "t5",
    trackName: "Admin",
  },
];

/** Same day, after the concurrent cluster — must keep full column width. */
export const SOLO_SESSION_AFTER: TimetableSession = {
  id: "s6",
  title: "Lunch",
  startsAt: "2026-06-08T12:00:00-04:00",
  endsAt: "2026-06-08T13:00:00-04:00",
  roomKey: null,
  roomLabel: null,
  trackId: null,
  trackName: null,
};
