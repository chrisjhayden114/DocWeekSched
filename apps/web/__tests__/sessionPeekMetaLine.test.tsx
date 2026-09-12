/**
 * @vitest-environment jsdom
 *
 * AGENDA-3 — the peek's meta line, after the dangling-separator fix.
 *
 * The bug, seen live: the track chip was the third item on the meta line,
 * behind a "·". When the chip wrapped, the separator stayed behind on the line
 * above and the popover read "A101 ·" with "Learning Technology" underneath.
 * A chip that wraps as a unit cannot be introduced by a character on the
 * previous line, so the track moved to its own row with no separator at all.
 *
 * The separators that remain now carry real spaces, so textContent and a
 * screen reader both read "… · A101" rather than running two facts together.
 */

import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SessionPeekContent } from "../components/SessionPeekContent";
import { formatEventTimeRange } from "../lib/dateFormat";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let root: Root;
let container: HTMLDivElement;

const SESSION = {
  id: "s1",
  title: "Designing calm learning days",
  startsAt: "2026-06-08T13:00:00.000Z",
  endsAt: "2026-06-08T14:00:00.000Z",
  room: { id: "r1", name: "A101" },
  track: { id: "t1", name: "Learning Technology", color: "#0033A0" },
};

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(node: ReactElement) {
  act(() => root.render(node));
}

function peek(props: Partial<Parameters<typeof SessionPeekContent>[0]> = {}) {
  render(
    <SessionPeekContent
      session={SESSION}
      timeZone="America/New_York"
      shareUrl="https://readyhall.test/session/s1"
      detailsHref="/session/s1"
      {...props}
    />,
  );
}

const metaLine = () => container.querySelector(".session-peek-meta")!;
const trackRow = () => container.querySelector(".session-peek-track-row");

/** "Mon, Jun 8 · 9:00 AM – 10:00 AM EDT", asked of the same formatter the
 * component uses — the assertions here are about what surrounds it, and
 * hard-coding it would break on an ICU update rather than on a real change. */
const TIME = formatEventTimeRange(SESSION.startsAt, SESSION.endsAt, "America/New_York");

describe("the meta line", () => {
  it("holds the time and the room, and nothing else", () => {
    peek();
    const text = metaLine().textContent!;
    expect(text).toBe(`${TIME} · A101`);
    expect(text).not.toContain("Learning Technology");
  });

  it("never ends on a separator, whatever is missing", () => {
    // This is the bug, stated directly: a trailing "·" means a separator
    // outlived the thing it was introducing.
    for (const session of [
      SESSION,
      { ...SESSION, room: null },
      { ...SESSION, track: null },
      { ...SESSION, room: null, track: null },
    ]) {
      peek({ session });
      expect(metaLine().textContent!.trimEnd()).not.toMatch(/·$/);
    }
  });

  it("drops the separator entirely when there is no room to introduce", () => {
    peek({ session: { ...SESSION, room: null } });
    expect(metaLine().querySelector(".session-peek-meta-sep")).toBeNull();
    expect(metaLine().textContent).toBe(TIME);
  });

  it("spells the separator with real spaces, for textContent and screen readers", () => {
    peek();
    const sep = metaLine().querySelector(".session-peek-meta-sep")!;
    expect(sep.textContent).toBe(" · ");
    // Not aria-hidden: the dot is the only thing separating two facts that are
    // otherwise read as one run of words.
    expect(sep.getAttribute("aria-hidden")).toBeNull();
  });

  it("keeps the room interactive, linking to its venue map pin", () => {
    peek({ roomMapHref: "/dashboard?tab=Maps&pinId=p1" });
    const link = metaLine().querySelector("a.session-peek-room-link") as HTMLAnchorElement;
    expect(link.textContent).toBe("A101");
    expect(link.getAttribute("href")).toBe("/dashboard?tab=Maps&pinId=p1");

    // In-app the same room is a button, so the map opens without a page load.
    peek({ onRoomMap: () => {} });
    expect((metaLine().querySelector("button.session-peek-room-link") as HTMLElement).textContent).toBe("A101");

    // With no pin it is plain text — there is nothing honest to link to.
    peek();
    expect(metaLine().querySelector(".session-peek-room-link")).toBeNull();
    expect(metaLine().textContent).toContain("A101");
  });
});

describe("the track chip", () => {
  it("sits on its own row, with no separator before it", () => {
    peek();
    const row = trackRow()!;
    expect(row.textContent).toBe("Learning Technology");
    expect(row.querySelector(".session-peek-meta-sep")).toBeNull();
    expect(row.querySelector(".session-peek-track")).not.toBeNull();
  });

  it("disappears completely when the session has no track", () => {
    peek({ session: { ...SESSION, track: null } });
    expect(trackRow()).toBeNull();
  });

  it("still carries the organizer's track color", () => {
    peek({ trackColor: "#8A4B08" });
    const chip = container.querySelector(".session-peek-track") as HTMLElement;
    expect(chip.style.getPropertyValue("--track-color")).toBe("#8A4B08");
  });
});

describe("the materials row", () => {
  it("lists shared materials with their sizes, beside the organizer's chips", () => {
    peek({
      session: {
        ...SESSION,
        fileUrl: "/f.pdf",
        materials: [
          { id: "sub-1", title: "Slide deck", kind: "file", mime: "application/pdf", sizeBytes: 2_400_000, url: null },
          { id: "sub-2", title: "Handout", kind: "link", mime: null, sizeBytes: null, url: "https://e.test/h" },
        ],
      },
    });
    const chips = [...container.querySelectorAll(".session-peek-chip")];
    expect(chips.map((c) => c.textContent)).toEqual(["Slides", "Slide deck2.4 MB", "Handout"]);
    expect((chips[2] as HTMLAnchorElement).getAttribute("href")).toBe("https://e.test/h");
    expect((chips[1] as HTMLAnchorElement).getAttribute("href")).toMatch(/\/materials\/sub-1\/file$/);
  });

  it("tells a signed-out visitor the slides exist rather than handing them a dead chip", () => {
    peek({ isPublic: true, materialsNote: true, detailsHref: "/login?next=%2Fsession%2Fs1" });
    const note = container.querySelector(".session-peek-materials-note")!;
    expect(note.textContent).toContain("Slides available to attendees");
    const link = note.querySelector("a") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/login?next=%2Fsession%2Fs1");
    // No chip, because there is no URL this visitor could open.
    expect(container.querySelector(".session-peek-chip")).toBeNull();
  });

  it("shows neither chips nor note when a session has no materials", () => {
    peek();
    expect(container.querySelector(".session-peek-materials")).toBeNull();
    expect(container.querySelector(".session-peek-materials-note")).toBeNull();
  });
});
