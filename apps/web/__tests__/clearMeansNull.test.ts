import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * FIX-NULL (4) — the web side of "absent means untouched".
 *
 * PUT /event and PUT /sessions/:id now leave out any nullable field the client
 * did not send. That is the right server contract, but it moves a burden onto
 * the callers: a form where the user just emptied a text box must say so out
 * loud. `field.trim() || undefined` disappears from a JSON body entirely, so
 * under the new contract it reads as "leave it alone" and the user watches
 * their deletion silently fail to save.
 *
 * These are source assertions rather than round-trips because the payloads are
 * built inline inside submit handlers (same approach as eventBranding.test.ts).
 * They are here to catch the specific regression of someone reintroducing
 * `|| undefined` on a clearable field.
 */

const webDir = join(__dirname, "..");
const read = (...parts: string[]) => readFileSync(join(webDir, ...parts), "utf8");

const settingsSrc = read("components", "organizer", "EventSettingsSlideOver.tsx");
const programSrc = read("components", "organizer", "ProgramTab.tsx");
const dashboardSrc = read("pages", "dashboard.tsx");

describe("PUT /event — the settings panel clears with null, never by omission", () => {
  // The panel is seeded from the stored event and shows every one of these, so
  // it can honestly speak for all of them on every save.
  const clearable = [
    "description",
    "venueName",
    "venueAddress",
    "onlineUrl",
    "brandColor",
    "logoUrl",
    "bannerUrl",
  ];

  it("sends an explicit null for every emptied field", () => {
    for (const field of clearable) {
      expect(settingsSrc, field).toContain(`${field}: form.${field}.trim() || null`);
    }
  });

  it("keeps `|| undefined` off the clearable fields entirely", () => {
    for (const field of clearable) {
      expect(settingsSrc, field).not.toContain(`${field}: form.${field}.trim() || undefined`);
    }
  });

  it("still omits only slug, where omission genuinely means keep", () => {
    expect(settingsSrc).toContain("slug: nextSlug && nextSlug !== event.slug ? nextSlug : undefined");
  });
});

describe("PUT /sessions/:id — the full session form clears with null or empty", () => {
  it("unlinks the directory speaker with null rather than by omitting the key", () => {
    expect(dashboardSrc).toContain('speakerId: String(form.get("speakerId") || "") || null');
    expect(dashboardSrc).not.toContain('speakerId: String(form.get("speakerId") || "") || undefined');
  });

  it("sends the visible text fields on every save, so emptying one clears it", () => {
    // These reach the server as "" when the user wipes them, which the server
    // normalizes to null — no omission involved.
    for (const field of ["location", "zoomLink", "fileLink"]) {
      expect(dashboardSrc, field).toContain(`${field}: String(form.get("${field}") || "")`);
    }
  });
});

describe("PUT /sessions/:id — the inline quick edit sends only what it edits", () => {
  it("no longer echoes the presenter's materials back to defend them", () => {
    // Echoing was the old workaround for the server's absent-means-null bug.
    // With the server fixed, echoing is pure risk: it writes whatever this
    // list last loaded over anything newer.
    const payload = programSrc.slice(
      programSrc.indexOf("function sessionUpdatePayload"),
      programSrc.indexOf("function OutsideDatesWarning"),
    );
    expect(payload).toBeTruthy();
    for (const field of [
      "description",
      "location",
      "speakers",
      "imageUrl",
      "zoomLink",
      "recordingUrl",
      "fileUrl",
      "fileLink",
      "speakerId",
      "allowVirtualJoin",
      "inPersonCapacity",
      "virtualCapacity",
    ]) {
      expect(payload, field).not.toContain(`existing.${field}`);
    }
  });

  it("still sends the fields the row edit actually offers", () => {
    for (const line of [
      "title: draft.title.trim()",
      "trackId: draft.trackId || null",
      "roomId: draft.roomId || null",
    ]) {
      expect(programSrc).toContain(line);
    }
  });
});
