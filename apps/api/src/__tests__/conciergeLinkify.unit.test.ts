/**
 * CHAT-2 — deterministic linkify for Event assistant replies.
 * linkifyReply is pure: anchors in, navigation offers out. No model URLs.
 */

import { describe, expect, it } from "vitest";
import { APP_GUIDE } from "@event-app/shared";
import {
  LINKIFY_MAX_LINKS,
  buildLinkifyAnchors,
  linkifyReply,
  type LinkifyAnchor,
} from "../lib/ai/concierge/linkify";

const sessionAnchor = (id: string, title: string): LinkifyAnchor => ({
  label: title,
  href: `/session/${id}`,
});

describe("Concierge linkify (unit)", () => {
  it("links a session title that appears verbatim in the reply", () => {
    const links = linkifyReply(
      "Calm Systems Design starts at 09:00 in Ballroom A.",
      [sessionAnchor("sess_1", "Calm Systems Design")],
    );
    expect(links).toEqual([{ label: "Calm Systems Design", href: "/session/sess_1" }]);
  });

  it("returns nothing for anchors that never appear in the reply", () => {
    const links = linkifyReply("Nothing is scheduled this morning.", [
      sessionAnchor("sess_1", "Calm Systems Design"),
    ]);
    expect(links).toEqual([]);
  });

  it("matches case-insensitively and keeps the reply's own casing as the label", () => {
    const links = linkifyReply(
      "open MY SCHEDULE in the agenda tab.",
      [{ label: "My Schedule", href: "/dashboard?tab=Agenda" }],
    );
    expect(links).toEqual([{ label: "MY SCHEDULE", href: "/dashboard?tab=Agenda" }]);
  });

  it("prefers the longest label when anchors overlap in the reply", () => {
    const links = linkifyReply(
      "Deep Dive: Calm Systems Design covers the calm approach.",
      [
        sessionAnchor("sess_short", "Calm Systems"),
        sessionAnchor("sess_long", "Deep Dive: Calm Systems Design"),
      ],
    );
    expect(links).toEqual([
      { label: "Deep Dive: Calm Systems Design", href: "/session/sess_long" },
    ]);
  });

  it("never claims overlapping spans and dedupes by href", () => {
    const links = linkifyReply(
      "Visit Maps for maps. Maps again.",
      [{ label: "Maps", href: "/dashboard?tab=Maps" }, { label: "Maps", href: "/dashboard?tab=Maps" }],
    );
    expect(links).toEqual([{ label: "Maps", href: "/dashboard?tab=Maps" }]);
  });

  it("respects word boundaries — 'Maps' does not fire inside 'roadmaps'", () => {
    const links = linkifyReply("Our roadmaps are private.", [
      { label: "Maps", href: "/dashboard?tab=Maps" },
    ]);
    expect(links).toEqual([]);
  });

  it("caps results at LINKIFY_MAX_LINKS, in reply order", () => {
    const anchors: LinkifyAnchor[] = [];
    const parts: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const title = `Workshop Number ${i} Extended`;
      anchors.push(sessionAnchor(`sess_${i}`, title));
      parts.push(title);
    }
    const links = linkifyReply(parts.join(", then "), anchors);
    expect(links).toHaveLength(LINKIFY_MAX_LINKS);
    expect(links[0].href).toBe("/session/sess_0");
    expect(links[LINKIFY_MAX_LINKS - 1].href).toBe(`/session/sess_${LINKIFY_MAX_LINKS - 1}`);
  });

  it("mixes session and guide anchors and orders links by reply position", () => {
    const anchors = buildLinkifyAnchors({
      sessions: [
        {
          id: "sess_1",
          title: "Calm Systems Design",
          startsAt: new Date("2027-06-01T09:00:00Z"),
          endsAt: new Date("2027-06-01T10:00:00Z"),
          roomId: null,
          trackId: null,
          description: null,
        },
        // Too short to become an anchor (< 8 chars).
        {
          id: "sess_2",
          title: "Break",
          startsAt: new Date("2027-06-01T10:00:00Z"),
          endsAt: new Date("2027-06-01T10:30:00Z"),
          roomId: null,
          trackId: null,
          description: null,
        },
      ],
    });
    const links = linkifyReply(
      "After the Break, Calm Systems Design runs at 09:00 — join it from My Schedule or check Maps for the room.",
      anchors,
    );
    expect(links).toEqual([
      { label: "Calm Systems Design", href: "/session/sess_1" },
      { label: "My Schedule", href: "/dashboard?tab=Agenda" },
      { label: "Maps", href: "/dashboard?tab=Maps" },
    ]);
  });

  it("builds anchors for every App Guide topic with the guide's own href", () => {
    const anchors = buildLinkifyAnchors({ sessions: [] });
    for (const entry of APP_GUIDE) {
      expect(anchors).toContainEqual({ label: entry.topic, href: entry.href });
    }
  });

  it("refuses anchors whose href is not an in-app path", () => {
    const links = linkifyReply("Open Evil Site now.", [
      { label: "Evil Site", href: "https://evil.example.com" },
    ]);
    expect(links).toEqual([]);
  });
});
