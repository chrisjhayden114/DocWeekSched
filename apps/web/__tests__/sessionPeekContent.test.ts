/**
 * AGENDA-1 — the peek's content rules: which primary action it offers, how the
 * speaker roster join works, what lands in the materials row, and the links it
 * copies. All pure, so they are pinned here rather than through the DOM.
 */

import { describe, expect, it } from "vitest";
import {
  PEEK_ACTION_LABEL,
  paperAuthors,
  peekMaterials,
  peekMeta,
  peekMetaParts,
  peekPrimaryAction,
  peekSpeakerList,
  publicSessionPath,
  sessionDetailPath,
  sessionShareUrl,
  speakerCredit,
  speakerInitials,
} from "../lib/sessionPeek";

const base = { startsAt: "2026-06-08T13:00:00.000Z", endsAt: "2026-06-08T14:30:00.000Z" };

describe("peekMetaParts", () => {
  it("splits the line the popover renders as nodes, and still joins to peekMeta", () => {
    const session = { ...base, room: { name: "Room 204" }, track: { name: "Leadership" } };
    const parts = peekMetaParts(session, "America/New_York");
    expect(parts).toEqual({
      time: "Mon, Jun 8 · 9:00 AM – 10:30 AM EDT",
      room: "Room 204",
      track: "Leadership",
    });
    // The sheet's one-string line is exactly the parts joined.
    expect(peekMeta(session, "America/New_York")).toBe([parts.time, parts.room, parts.track].join(" · "));
  });

  it("falls back to the free-text location and drops what is missing", () => {
    expect(peekMetaParts({ ...base, location: "Main Hall" }, "UTC").room).toBe("Main Hall");
    expect(peekMetaParts(base, "UTC")).toEqual({
      time: "Mon, Jun 8 · 1:00 PM – 2:30 PM UTC",
      room: null,
      track: null,
    });
  });
});

describe("peekPrimaryAction", () => {
  it("offers sign-in on the public page, whatever else is true", () => {
    expect(peekPrimaryAction({ isPublic: true, joined: true, full: true, pickOne: true })).toBe("publicJoin");
    expect(PEEK_ACTION_LABEL.publicJoin).toBe("Join to build your schedule");
  });

  it("shows Added when joined, and Add to my schedule otherwise", () => {
    expect(peekPrimaryAction({ joined: true })).toBe("joined");
    expect(peekPrimaryAction({})).toBe("join");
    expect(PEEK_ACTION_LABEL.joined).toBe("Added ✓");
    expect(PEEK_ACTION_LABEL.join).toBe("Add to my schedule");
  });

  it("states a full room before the click, even inside a pick-one slot", () => {
    expect(peekPrimaryAction({ full: true })).toBe("waitlist");
    expect(peekPrimaryAction({ full: true, pickOne: true })).toBe("waitlist");
    expect(peekPrimaryAction({ pickOne: true })).toBe("chooseOne");
    expect(PEEK_ACTION_LABEL.chooseOne).toBe("Choose this session");
  });

  it("a joined session reads as joined before it reads as full", () => {
    expect(peekPrimaryAction({ joined: true, full: true })).toBe("joined");
  });
});

describe("peekSpeakerList", () => {
  const roster = [
    { id: "sp1", name: "Maya Chen", title: "Coach", affiliation: "Riverside", photoUrl: "/p/maya.svg", bio: "Bio." },
  ];

  it("prefers the linked in-app rows, which already carry photos", () => {
    const people = peekSpeakerList({
      sessionSpeakers: [{ speaker: { id: "sp1", name: "Maya Chen", photoUrl: "/p/maya.svg" } }],
      speakers: "ignored free text",
    });
    expect(people.map((p) => p.name)).toEqual(["Maya Chen"]);
    expect(people[0]!.photoUrl).toBe("/p/maya.svg");
  });

  it("enriches a thin public payload from the event roster by id", () => {
    const people = peekSpeakerList({ speakers: [{ id: "sp1", name: "Maya Chen" }] }, roster);
    expect(people[0]).toMatchObject({
      name: "Maya Chen",
      title: "Coach",
      affiliation: "Riverside",
      photoUrl: "/p/maya.svg",
    });
  });

  it("leaves a speaker who is not on the roster alone", () => {
    const people = peekSpeakerList({ speakers: [{ id: "nope", name: "Guest" }] }, roster);
    expect(people[0]!.photoUrl ?? null).toBeNull();
    expect(people[0]!.name).toBe("Guest");
  });

  it("yields nothing for the legacy free-text blob, which is one line not people", () => {
    expect(peekSpeakerList({ speakers: "Dr. A, Dr. B" })).toEqual([]);
    expect(peekSpeakerList({ speaker: { name: "Dr. C" } })).toEqual([]);
  });

  it("keeps multi-speaker order", () => {
    const people = peekSpeakerList({
      sessionSpeakers: [{ speaker: { name: "First" } }, { speaker: { name: "Second" } }],
    });
    expect(people.map((p) => p.name)).toEqual(["First", "Second"]);
  });
});

describe("avatars and credits", () => {
  it("builds initials from the first and last word", () => {
    expect(speakerInitials("Maya Chen")).toBe("MC");
    expect(speakerInitials("Jonas Adebayo Okonkwo")).toBe("JO");
    expect(speakerInitials("Prince")).toBe("P");
    expect(speakerInitials("   ")).toBe("?");
  });

  it("puts title and affiliation on one line, dropping what is missing", () => {
    expect(speakerCredit({ name: "A", title: "Coach", affiliation: "Riverside" })).toBe("Coach, Riverside");
    expect(speakerCredit({ name: "A", affiliation: "Riverside" })).toBe("Riverside");
    expect(speakerCredit({ name: "A" })).toBe("");
  });
});

describe("papers", () => {
  it("marks the presenter so the row can bold them", () => {
    expect(
      paperAuthors({
        title: "Ten minutes of reading conferences",
        authors: [{ name: "Aisha Rahman", isPresenter: true }, { name: "Jonas Okonkwo" }],
      }),
    ).toEqual([
      { name: "Aisha Rahman", isPresenter: true },
      { name: "Jonas Okonkwo", isPresenter: false },
    ]);
    expect(paperAuthors({ title: "No authors" })).toEqual([]);
  });
});

describe("peekMaterials", () => {
  it("orders the chips and hides the row when there is nothing", () => {
    expect(peekMaterials({})).toEqual([]);
    expect(
      peekMaterials(
        { fileUrl: "/f.pdf", fileLink: "https://e.test/r", recordingUrl: "https://e.test/v", zoomLink: "https://z.test" },
        { includeOnline: true },
      ).map((m) => m.label),
    ).toEqual(["Slides", "Resources", "Recording", "Join online"]);
  });

  it("never leaks the meeting link to the public page", () => {
    const material = peekMaterials({ zoomLink: "https://zoom.test/j/1" });
    expect(material).toEqual([]);
  });
});

describe("copyable links", () => {
  it("copies the session page in-app and the agenda card on the public page", () => {
    expect(sessionDetailPath("s1")).toBe("/session/s1");
    expect(publicSessionPath("demo", "s1")).toBe("/e/demo#session-s1");
    expect(sessionShareUrl("/session/s1", "https://readyhall.test")).toBe("https://readyhall.test/session/s1");
    // Trailing slashes on the origin must not double up.
    expect(sessionShareUrl("/session/s1", "https://readyhall.test/")).toBe("https://readyhall.test/session/s1");
    // No origin (server render): the path is still a usable relative link.
    expect(sessionShareUrl("/session/s1", null)).toBe("/session/s1");
  });
});
