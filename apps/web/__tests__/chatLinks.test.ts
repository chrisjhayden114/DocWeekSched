/**
 * CHAT-2 — splitByLinks: assistant bodies become text/link segments; only
 * internal hrefs may be inlined; unmatched links fall back to the chip row.
 */

import { describe, expect, it } from "vitest";
import { splitByLinks, unmatchedLinks, isInternalHref } from "../lib/chatLinks";

describe("chatLinks.splitByLinks", () => {
  it("splits a single matched label into text / link / text segments", () => {
    const segments = splitByLinks("Open My Schedule to export.", [
      { label: "My Schedule", href: "/dashboard?tab=Agenda" },
    ]);
    expect(segments).toEqual([
      { type: "text", text: "Open " },
      { type: "link", text: "My Schedule", href: "/dashboard?tab=Agenda" },
      { type: "text", text: " to export." },
    ]);
  });

  it("matches case-insensitively and keeps the body's own casing", () => {
    const segments = splitByLinks("open my schedule now", [
      { label: "My Schedule", href: "/dashboard?tab=Agenda" },
    ]);
    expect(segments).toContainEqual({
      type: "link",
      text: "my schedule",
      href: "/dashboard?tab=Agenda",
    });
  });

  it("handles multiple links in body order without overlaps", () => {
    const body = "Calm Systems Design is at 09:00 — see Maps for the room.";
    const segments = splitByLinks(body, [
      { label: "Maps", href: "/dashboard?tab=Maps" },
      { label: "Calm Systems Design", href: "/session/sess_1" },
    ]);
    expect(segments).toEqual([
      { type: "link", text: "Calm Systems Design", href: "/session/sess_1" },
      { type: "text", text: " is at 09:00 — see " },
      { type: "link", text: "Maps", href: "/dashboard?tab=Maps" },
      { type: "text", text: " for the room." },
    ]);
    // Reassembling the segments reproduces the body exactly.
    expect(segments.map((s) => s.text).join("")).toBe(body);
  });

  it("resolves overlapping labels longest-first, one span per link", () => {
    const segments = splitByLinks("Deep Dive: Calm Systems Design today.", [
      { label: "Calm Systems", href: "/session/sess_short" },
      { label: "Deep Dive: Calm Systems Design", href: "/session/sess_long" },
    ]);
    const linkSegments = segments.filter((s) => s.type === "link");
    expect(linkSegments).toEqual([
      { type: "link", text: "Deep Dive: Calm Systems Design", href: "/session/sess_long" },
    ]);
  });

  it("refuses external hrefs — they never become inline links", () => {
    const links = [
      { label: "Evil Site", href: "https://evil.example.com" },
      { label: "Sneaky", href: "//evil.example.com" },
    ];
    const segments = splitByLinks("Evil Site and Sneaky both appear here.", links);
    expect(segments.every((s) => s.type === "text")).toBe(true);
    // Unmatched (refused) links stay available for the chip row.
    expect(unmatchedLinks(segments, links)).toEqual(links);
  });

  it("returns the whole body as one text segment when nothing matches", () => {
    const segments = splitByLinks("No anchors here.", [
      { label: "My Schedule", href: "/dashboard?tab=Agenda" },
    ]);
    expect(segments).toEqual([{ type: "text", text: "No anchors here." }]);
  });

  it("unmatchedLinks separates inlined links from leftover chips", () => {
    const links = [
      { label: "My Schedule", href: "/dashboard?tab=Agenda" },
      { label: "Open “Hot Topics”", href: "/session/sess_1" },
    ];
    const segments = splitByLinks("Check My Schedule.", links);
    expect(unmatchedLinks(segments, links)).toEqual([
      { label: "Open “Hot Topics”", href: "/session/sess_1" },
    ]);
  });
});

describe("chatLinks.isInternalHref", () => {
  it("accepts app paths and rejects absolute/protocol-relative URLs", () => {
    expect(isInternalHref("/session/abc")).toBe(true);
    expect(isInternalHref("/dashboard?tab=Maps")).toBe(true);
    expect(isInternalHref("https://x.example")).toBe(false);
    expect(isInternalHref("//x.example")).toBe(false);
    expect(isInternalHref("javascript:alert(1)")).toBe(false);
  });
});
