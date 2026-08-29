import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyEventTabToQuery,
  EVENT_TABS,
  eventTabQueryValue,
  HISTORICAL_EVENT_TAB_IDS,
  resolveEventTab,
} from "../lib/eventTabs";

describe("K-6.1 — event console tab resolution", () => {
  it("keeps every current strip id renderable, and Participants still covers invites", () => {
    expect(EVENT_TABS).toContain("invites");
    expect(resolveEventTab("invites").tab).toBe("invites");
    expect(resolveEventTab("participants").tab).toBe("invites");
    expect(eventTabQueryValue("invites")).toBe("participants");
  });

  it("redirects the legacy invites query to the public participants spelling", () => {
    const legacy = resolveEventTab("invites");
    expect(legacy.tab).toBe("invites");
    expect(legacy.urlTab).toBe("participants");
    expect(legacy.rewrite).toBe(true);

    const publicId = resolveEventTab("participants");
    expect(publicId.tab).toBe("invites");
    expect(publicId.urlTab).toBe("participants");
    expect(publicId.rewrite).toBe(false);
  });

  it("every historical tab id plus a junk value resolves without throwing", () => {
    const junk = ["not-a-tab", "speakers", "agenda", "???", "invites%20", ""];
    for (const id of [...HISTORICAL_EVENT_TAB_IDS, ...junk]) {
      expect(() => resolveEventTab(id)).not.toThrow();
      const resolved = resolveEventTab(id);
      expect(EVENT_TABS).toContain(resolved.tab);
    }
    expect(resolveEventTab("not-a-tab")).toEqual({
      tab: "overview",
      urlTab: undefined,
      rewrite: true,
    });
    expect(resolveEventTab(["junk", "program"])).toEqual({
      tab: "overview",
      urlTab: undefined,
      rewrite: true,
    });
  });

  it("unknown values fall back to Overview and ask the URL to drop the param", () => {
    expect(resolveEventTab("nope").rewrite).toBe(true);
    expect(resolveEventTab("nope").urlTab).toBeUndefined();
    expect(resolveEventTab(undefined)).toEqual({
      tab: "overview",
      urlTab: undefined,
      rewrite: false,
    });
    expect(resolveEventTab("overview")).toEqual({
      tab: "overview",
      urlTab: undefined,
      rewrite: false,
    });
  });

  it("the event page resolves tabs through resolveEventTab (never indexes raw ?tab=)", () => {
    const page = readFileSync(
      join(__dirname, "..", "pages", "organizer", "events", "[eventId]", "index.tsx"),
      "utf8",
    );
    expect(page).toContain("resolveEventTab");
    expect(page).toContain("applyEventTabToQuery");
    expect(page).toContain('id: "invites"');
    expect(page).toContain('{tab === "invites" ? (');
  });

  it("writes Participants as ?tab=participants, not the strip id", () => {
    const query: Record<string, string> = { eventId: "e1" };
    applyEventTabToQuery(query, "invites");
    expect(query.tab).toBe("participants");
    applyEventTabToQuery(query, "program");
    expect(query.tab).toBe("program");
    applyEventTabToQuery(query, "overview");
    expect(query.tab).toBeUndefined();
  });
});
