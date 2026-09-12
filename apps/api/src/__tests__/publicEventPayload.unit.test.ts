/**
 * AGENDA-1 — the public session payload contract.
 *
 * The session peek popover on /e/:slug needs three fields the payload did not
 * used to carry: the organizer's track color, a stable room id, and speaker
 * photos. These are additive, so the test pins both the new fields AND every
 * field an older client already reads.
 */

import { describe, expect, it } from "vitest";
import { toPublicSession, type PublicSessionRow } from "../lib/publicEvent";

const row: PublicSessionRow = {
  id: "sess-1",
  title: "Practice showcase: What worked this year",
  description: "Short talks from teams trying something new.",
  location: null,
  startsAt: new Date("2026-06-08T16:00:00.000Z"),
  endsAt: new Date("2026-06-08T17:30:00.000Z"),
  track: { name: "Practice", color: "#8A4B08" },
  room: { id: "room-library", name: "Library" },
  sessionSpeakers: [
    {
      speaker: {
        id: "spk-jonas",
        name: "Jonas Okonkwo",
        title: "Head of Teaching and Learning",
        affiliation: "Northbridge Academy",
        photoUrl: "/demo/speakers/jonas-okonkwo.svg",
      },
    },
    {
      speaker: {
        id: "spk-elena",
        name: "Elena Ruiz",
        title: "Curriculum Lead",
        affiliation: "Open Learning Collaborative",
        photoUrl: null,
      },
    },
  ],
  items: [
    {
      id: "item-1",
      title: "Ten minutes of reading conferences, every day",
      abstract: "What changed when one grade-level team protected ten minutes a day.",
      sortOrder: 0,
      authors: [
        { name: "Aisha Rahman", isPresenter: true, sortOrder: 0 },
        { name: "Jonas Okonkwo", isPresenter: false, sortOrder: 1 },
      ],
    },
  ],
};

describe("toPublicSession", () => {
  it("carries the track color for the peek's track chip", () => {
    expect(toPublicSession(row).trackColor).toBe("#8A4B08");
    expect(toPublicSession({ ...row, track: null }).trackColor).toBeNull();
    // A track with no organizer color still names itself; the palette decides.
    expect(toPublicSession({ ...row, track: { name: "Practice", color: null } })).toMatchObject({
      trackName: "Practice",
      trackColor: null,
    });
  });

  it("carries a stable room id alongside the room name", () => {
    const payload = toPublicSession(row);
    expect(payload.roomId).toBe("room-library");
    expect(payload.roomName).toBe("Library");
    expect(toPublicSession({ ...row, room: null }).roomId).toBeNull();
  });

  it("carries each speaker's photo, in roster order", () => {
    const { speakers } = toPublicSession(row);
    expect(speakers.map((s) => s.name)).toEqual(["Jonas Okonkwo", "Elena Ruiz"]);
    expect(speakers[0]!.photoUrl).toBe("/demo/speakers/jonas-okonkwo.svg");
    // A speaker with no photo is null, not absent — the peek renders initials.
    expect(speakers[1]!.photoUrl).toBeNull();
    expect("photoUrl" in speakers[1]!).toBe(true);
  });

  it("still emits every field the page already read (additive change)", () => {
    const payload = toPublicSession(row);
    expect(payload).toMatchObject({
      id: "sess-1",
      title: "Practice showcase: What worked this year",
      description: "Short talks from teams trying something new.",
      startsAt: "2026-06-08T16:00:00.000Z",
      endsAt: "2026-06-08T17:30:00.000Z",
      trackName: "Practice",
      roomName: "Library",
    });
    expect(payload.items[0]).toMatchObject({ title: "Ten minutes of reading conferences, every day" });
    expect(payload.items[0]!.authors[0]).toEqual({ name: "Aisha Rahman", isPresenter: true, sortOrder: 0 });
  });

  it("falls back to the room name for `location` when the session has no free text", () => {
    expect(toPublicSession(row).location).toBe("Library");
    expect(toPublicSession({ ...row, location: "Tent B" }).location).toBe("Tent B");
    expect(toPublicSession({ ...row, location: null, room: null }).location).toBeNull();
  });

  it("never leaks a speaker's bio into the per-session rows", () => {
    // Bios belong to the event-level roster, which the page joins by id.
    expect(Object.keys(toPublicSession(row).speakers[0]!)).toEqual([
      "id",
      "name",
      "title",
      "affiliation",
      "photoUrl",
    ]);
  });
});
