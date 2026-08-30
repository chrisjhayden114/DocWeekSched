/**
 * AGENT-3 — the Organizer Guide is prompt data AND the source of link
 * anchors, so its shape is load-bearing: in-app hrefs only, unique topics
 * (linkify dedupes by href, topics must not collide), and {eventId}
 * substitution that leaves no placeholder behind.
 */

import { describe, expect, it } from "vitest";
import { APP_GUIDE, ORGANIZER_GUIDE, resolveOrganizerGuideHref } from "@event-app/shared";
import { buildOrganizerGuideAnchors, linkifyOrganizerReply } from "../lib/ai/setupCopilot/links";

describe("Organizer Guide (unit)", () => {
  it("every href is an in-app path starting with /", () => {
    for (const entry of ORGANIZER_GUIDE) {
      expect(entry.href.startsWith("/"), `${entry.id} href: ${entry.href}`).toBe(true);
      expect(entry.href.startsWith("//"), `${entry.id} href: ${entry.href}`).toBe(false);
    }
  });

  it("topics are unique", () => {
    const topics = ORGANIZER_GUIDE.map((e) => e.topic);
    expect(new Set(topics).size).toBe(topics.length);
  });

  it("ids are unique and every entry has text", () => {
    const ids = ORGANIZER_GUIDE.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of ORGANIZER_GUIDE) {
      expect(entry.text.trim().length).toBeGreaterThan(0);
    }
  });

  it("resolveOrganizerGuideHref substitutes the event id everywhere", () => {
    expect(
      resolveOrganizerGuideHref("/organizer/events/{eventId}?tab=program", "evt_1"),
    ).toBe("/organizer/events/evt_1?tab=program");
    // Non-event-scoped hrefs pass through unchanged.
    expect(resolveOrganizerGuideHref("/organizer/billing", "evt_1")).toBe("/organizer/billing");
  });

  it("anchors carry no {eventId} placeholder after substitution", () => {
    for (const anchor of buildOrganizerGuideAnchors("evt_abc123")) {
      expect(anchor.href).not.toContain("{eventId}");
      expect(anchor.href.startsWith("/")).toBe(true);
    }
  });

  it("linkifyOrganizerReply links guide topics that appear verbatim in a reply", () => {
    const links = linkifyOrganizerReply(
      "Add rooms in the Program tab, then press Publish on Overview.",
      "evt_1",
    );
    expect(links).toContainEqual({ label: "Program", href: "/organizer/events/evt_1?tab=program" });
    expect(links).toContainEqual({ label: "Publish", href: "/organizer/events/evt_1?tab=overview" });
  });

  it("GUIDE-1 topics ship with concrete hrefs and become linkify anchors", () => {
    const required: Array<{ id: string; hrefNeedle: string }> = [
      { id: "sponsor-outreach", hrefNeedle: "/sponsors" },
      { id: "cfp-page", hrefNeedle: "/cfp" },
      { id: "registration-fees", hrefNeedle: "tab=participants" },
      { id: "certificates", hrefNeedle: "tab=recap" },
      { id: "maps-tab", hrefNeedle: "tab=maps" },
      { id: "session-polls", hrefNeedle: "tab=features" },
      { id: "session-feedback", hrefNeedle: "tab=features" },
    ];
    const anchors = buildOrganizerGuideAnchors("evt_1");
    for (const { id, hrefNeedle } of required) {
      const entry = ORGANIZER_GUIDE.find((e) => e.id === id);
      expect(entry, id).toBeDefined();
      expect(entry!.href).toContain(hrefNeedle);
      expect(entry!.text.trim().length).toBeGreaterThan(0);
      expect(anchors).toContainEqual({
        label: entry!.topic,
        href: resolveOrganizerGuideHref(entry!.href, "evt_1"),
      });
    }
    expect(ORGANIZER_GUIDE.find((e) => e.id === "features-tab")?.text).toMatch(
      /Everything on \/ Focused \/ Academic \/ PD day \/ Talk showcase/,
    );
    expect(ORGANIZER_GUIDE.find((e) => e.id === "participants-tab")?.text).toMatch(/Not invited/i);
    expect(ORGANIZER_GUIDE.find((e) => e.id === "agenda-ingest")?.text).toMatch(/paste text/i);
    expect(ORGANIZER_GUIDE.find((e) => e.id === "event-settings")?.text).toMatch(/CFP label/i);
  });

  it("GUIDE-1 attendee App Guide topics ship with in-app hrefs", () => {
    const required = [
      "certificates",
      "registration-fee",
      "meet-tab",
      "attendees-tab",
      "session-polls",
      "session-feedback",
      "community-meetups",
      "community-moments",
      "community-icebreakers",
    ];
    for (const id of required) {
      const entry = APP_GUIDE.find((e) => e.id === id);
      expect(entry, id).toBeDefined();
      expect(entry!.href.startsWith("/"), `${id} href`).toBe(true);
      expect(entry!.text.trim().length).toBeGreaterThan(0);
    }
  });
});
