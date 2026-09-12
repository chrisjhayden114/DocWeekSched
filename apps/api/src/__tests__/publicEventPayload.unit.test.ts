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
  format: "lightning",
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

  it("carries the session format, and drops a value outside the vocabulary", () => {
    // AGENDA-2. The column is a plain String, so a hand-edited or
    // partially-migrated row can hold anything. The public payload is the last
    // place to catch that: letting "roundtable" through would put an option in
    // the attendee's format filter that nothing in the app can label.
    expect(toPublicSession(row).format).toBe("lightning");
    expect(toPublicSession({ ...row, format: null }).format).toBeNull();
    expect(toPublicSession({ ...row, format: "roundtable" }).format).toBeNull();
    expect(toPublicSession({ ...row, format: "Keynote" }).format).toBeNull();
  });

  it("says materials exist without naming them when the event is attendees-only", () => {
    // AGENDA-3. This is the whole privacy split in one assertion: a signed-out
    // visitor to an ATTENDEES event learns there ARE slides — enough for the
    // card glyph and the "has materials" filter — and learns nothing else. A
    // filename can carry a working title, a draft number, or a person's name.
    const shared = [
      { id: "sub-1", title: "Slide deck", kind: "file" as const, mime: "application/pdf", sizeBytes: 2_400_000, url: null },
    ];
    const gated = toPublicSession(row, { shared, isPublic: false });
    expect(gated.hasMaterials).toBe(true);
    expect(gated.materials).toEqual([]);
  });

  it("hands over the metadata, and only the metadata, when the event is public", () => {
    const shared = [
      { id: "sub-1", title: "Slide deck", kind: "file" as const, mime: "application/pdf", sizeBytes: 2_400_000, url: null },
      { id: "sub-2", title: "Handout", kind: "link" as const, mime: null, sizeBytes: null, url: "https://e.test/h" },
    ];
    const open = toPublicSession(row, { shared, isPublic: true });
    expect(open.hasMaterials).toBe(true);
    expect(open.materials.map((m) => m.title)).toEqual(["Slide deck", "Handout"]);
    // A FILE never carries a URL: it is fetched from GET /materials/:id/file,
    // which re-runs the gate. Only a link the presenter typed carries one.
    expect(open.materials[0]!.url).toBeNull();
    expect(open.materials[1]!.url).toBe("https://e.test/h");
  });

  it("reads as no materials when the caller passes none, however it is called", () => {
    for (const payload of [
      toPublicSession(row),
      toPublicSession(row, { shared: [], isPublic: true }),
      toPublicSession(row, { shared: [], isPublic: false }),
    ]) {
      expect(payload.hasMaterials).toBe(false);
      expect(payload.materials).toEqual([]);
    }
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
