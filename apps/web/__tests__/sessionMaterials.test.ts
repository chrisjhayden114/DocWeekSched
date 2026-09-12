/**
 * AGENDA-3 — presenter materials on the agenda: what lands in the peek's
 * materials row, how a shared file is addressed, and what the
 * "Has slides or materials" filter now counts.
 *
 * The AGENDA-1 contract for `peekMaterials` is pinned in
 * sessionPeekContent.test.ts and stays exactly as it was; this file covers the
 * rows that were appended after it.
 */

import { describe, expect, it } from "vitest";
import {
  formatMaterialSize,
  peekMaterials,
  sharedMaterialGlyph,
  sharedMaterialHref,
  type PeekSharedMaterial,
} from "../lib/sessionPeek";
import { hasSessionMaterials } from "../lib/agendaFilters";

const API = "https://api.readyhall.test";

const deck: PeekSharedMaterial = {
  id: "sub-1",
  title: "Slide deck",
  kind: "file",
  mime: "application/pdf",
  sizeBytes: 2_400_000,
  url: null,
};

const handout: PeekSharedMaterial = {
  id: "sub-2",
  title: "Handout",
  kind: "link",
  mime: null,
  sizeBytes: null,
  url: "https://e.test/handout",
};

describe("sharedMaterialHref", () => {
  it("sends a file through the API's gated route, never a raw URL", () => {
    expect(sharedMaterialHref(deck, API)).toBe(`${API}/materials/sub-1/file`);
    // A trailing slash on the configured origin must not double up.
    expect(sharedMaterialHref(deck, `${API}/`)).toBe(`${API}/materials/sub-1/file`);
  });

  it("uses a link's own URL", () => {
    expect(sharedMaterialHref(handout, API)).toBe("https://e.test/handout");
    expect(sharedMaterialHref({ ...handout, url: "   " }, API)).toBeNull();
    expect(sharedMaterialHref({ ...handout, url: null }, API)).toBeNull();
  });
});

describe("sharedMaterialGlyph", () => {
  it("tells a deck, a document, an image and a link apart", () => {
    expect(sharedMaterialGlyph(deck)).toBe("slides");
    expect(sharedMaterialGlyph({ ...deck, mime: "application/vnd.ms-powerpoint" })).toBe("slides");
    expect(
      sharedMaterialGlyph({
        ...deck,
        mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      }),
    ).toBe("slides");
    expect(sharedMaterialGlyph({ ...deck, mime: "image/png" })).toBe("image");
    expect(sharedMaterialGlyph({ ...deck, mime: "image/jpeg" })).toBe("image");
    expect(sharedMaterialGlyph({ ...deck, mime: "application/msword" })).toBe("resources");
    expect(sharedMaterialGlyph({ ...deck, mime: null })).toBe("resources");
    expect(sharedMaterialGlyph(handout)).toBe("link");
  });
});

describe("formatMaterialSize", () => {
  it("reads the way an operating system does", () => {
    expect(formatMaterialSize(2_400_000)).toBe("2.4 MB");
    expect(formatMaterialSize(24_000_000)).toBe("24 MB");
    expect(formatMaterialSize(240_000)).toBe("240 KB");
    expect(formatMaterialSize(755)).toBe("755 B");
  });

  it("says nothing rather than something wrong", () => {
    // A missing or nonsensical size must not render as "0 B", which would read
    // as an empty file the presenter uploaded by mistake.
    for (const bad of [0, -1, null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatMaterialSize(bad)).toBeNull();
    }
  });
});

describe("peekMaterials with shared materials", () => {
  it("appends shared materials after the organizer's own chips", () => {
    const row = peekMaterials(
      { fileUrl: "/f.pdf", recordingUrl: "https://e.test/v", materials: [deck, handout] },
      { apiUrl: API },
    );
    expect(row.map((m) => m.label)).toEqual(["Slides", "Recording", "Slide deck", "Handout"]);
    expect(row.map((m) => m.key)).toEqual(["slides", "recording", "shared-sub-1", "shared-sub-2"]);
  });

  it("gives every chip a distinct key, even when two decks share a glyph", () => {
    // The row used to be keyed by `kind`, which was unique when the only
    // sources were three columns. Two shared PDFs both read "slides".
    const row = peekMaterials(
      { materials: [deck, { ...deck, id: "sub-9", title: "Appendix" }] },
      { apiUrl: API },
    );
    expect(new Set(row.map((m) => m.key)).size).toBe(2);
    expect(row.every((m) => m.kind === "slides")).toBe(true);
  });

  it("carries the size on a file and leaves it off a link", () => {
    const row = peekMaterials({ materials: [deck, handout] }, { apiUrl: API });
    expect(row[0]!.sizeLabel).toBe("2.4 MB");
    expect(row[1]!.sizeLabel).toBeNull();
  });

  it("drops a file rather than pointing it at the wrong origin", () => {
    // Without an API origin a file's href would resolve against the web app,
    // where it 404s. A link still works, because it carries its own URL.
    const row = peekMaterials({ materials: [deck, handout] });
    expect(row.map((m) => m.label)).toEqual(["Handout"]);
  });

  it("drops a link with nothing to open", () => {
    expect(peekMaterials({ materials: [{ ...handout, url: null }] }, { apiUrl: API })).toEqual([]);
  });

  it("still hides the row when a session has nothing at all", () => {
    expect(peekMaterials({ materials: [] }, { apiUrl: API })).toEqual([]);
    expect(peekMaterials({ materials: null }, { apiUrl: API })).toEqual([]);
  });
});

describe("hasSessionMaterials", () => {
  it("still counts the organizer's three columns (AGENDA-2)", () => {
    expect(hasSessionMaterials({ id: "s", title: "t", startsAt: "", endsAt: "", fileUrl: "/f.pdf" })).toBe(true);
    expect(hasSessionMaterials({ id: "s", title: "t", startsAt: "", endsAt: "", fileLink: "https://e.test" })).toBe(true);
    expect(hasSessionMaterials({ id: "s", title: "t", startsAt: "", endsAt: "", recordingUrl: "https://e.test" })).toBe(true);
    expect(hasSessionMaterials({ id: "s", title: "t", startsAt: "", endsAt: "" })).toBe(false);
  });

  it("counts a shared deck, from either shape the API sends", () => {
    const base = { id: "s", title: "t", startsAt: "", endsAt: "" };
    // In-app and PUBLIC events get the array...
    expect(hasSessionMaterials({ ...base, materials: [deck] })).toBe(true);
    // ...and a signed-out visitor to an ATTENDEES event gets only the flag,
    // which still has to light the card glyph and satisfy the filter.
    expect(hasSessionMaterials({ ...base, hasMaterials: true })).toBe(true);
    expect(hasSessionMaterials({ ...base, materials: [], hasMaterials: false })).toBe(false);
  });
});
