/**
 * PRESENTER-ROSTER-1 — closed vocabulary. The column is a plain String, so
 * a typo or a hand-edited row can hold anything. Unknown values must never
 * hand out names.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRESENTER_ROSTER_VISIBILITY,
  PRESENTER_ROSTER_VISIBILITIES,
  PRESENTER_ROSTER_VISIBILITY_HELP,
  PRESENTER_ROSTER_VISIBILITY_LABELS,
  PRESENTER_ROSTER_VISIBILITY_SETTING_HELP,
  PRESENTER_ROSTER_VISIBILITY_SETTING_TITLE,
  asPresenterRosterVisibility,
  presenterRosterVisibilityOrDefault,
  presenterRosterVisibilitySelectOptions,
  shapeDirectoryVisibleAttendee,
  shapePortalEvent,
  shapePortalSessionDetail,
  shapePortalSpeaker,
} from "@event-app/shared";
import { DEMO_ROSTER_JOINERS, buildDemoFixtureSpec } from "../lib/demoEvent/fixture";

function identityKeys(value: unknown): string[] {
  const found: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (key === "email" || key === "userId") found.push(key);
      walk(child);
    }
  };
  walk(JSON.parse(JSON.stringify(value)) as unknown);
  return found;
}

describe("presenterRosterVisibility vocabulary", () => {
  it("is three values, and COUNTS is the default", () => {
    expect([...PRESENTER_ROSTER_VISIBILITIES]).toEqual(["OFF", "COUNTS", "NAMES"]);
    expect(DEFAULT_PRESENTER_ROSTER_VISIBILITY).toBe("COUNTS");
  });

  it("fails CLOSED on anything it does not recognise — never NAMES", () => {
    for (const bad of ["names", "Names", "EVERYONE", "ATTENDEES", "", null, undefined, 7, {}]) {
      expect(asPresenterRosterVisibility(bad)).toBeNull();
      expect(presenterRosterVisibilityOrDefault(bad)).toBe("COUNTS");
    }
    expect(asPresenterRosterVisibility("NAMES")).toBe("NAMES");
    expect(asPresenterRosterVisibility("OFF")).toBe("OFF");
  });

  it("labels say what the presenter sees, not the internal tokens", () => {
    expect(presenterRosterVisibilitySelectOptions().map((o) => o.value)).toEqual([
      "OFF",
      "COUNTS",
      "NAMES",
    ]);
    for (const value of PRESENTER_ROSTER_VISIBILITIES) {
      expect(PRESENTER_ROSTER_VISIBILITY_LABELS[value]).not.toMatch(/\b(OFF|COUNTS|NAMES)\b/);
      expect(PRESENTER_ROSTER_VISIBILITY_HELP[value].length).toBeGreaterThan(20);
    }
    expect(PRESENTER_ROSTER_VISIBILITY_SETTING_TITLE).toBe(
      "What presenters can see about their sessions",
    );
    expect(PRESENTER_ROSTER_VISIBILITY_SETTING_HELP).toContain(
      "Presenters open this from their personal link",
    );
    expect(PRESENTER_ROSTER_VISIBILITY_SETTING_HELP).toContain(
      "visible in the attendee directory",
    );
  });
});

describe("presenter home payload", () => {
  it("serializes with no email or userId keys", () => {
    const leaked = {
      id: "user_1",
      email: "priya.shah@demo.readyhall.com",
      userId: "user_1",
      joinMode: "IN_PERSON",
      name: "Priya Shah",
      title: "Grade 4 teacher",
      affiliation: "Riverside School District",
      photoUrl: "/demo/speakers/priya-shah.svg",
    };
    const paperAuthors = [
      { name: "Maya Chen", isPresenter: true, speakerId: "spk_1", email: "maya@example.com" },
      { name: "Jonas Okonkwo", isPresenter: false, userId: "user_2" },
    ];
    const payload = {
      speaker: shapePortalSpeaker({
        name: "Maya Chen",
        title: "Instructional Coach",
        affiliation: "Riverside School District",
        bio: "Leads professional learning at a K-12 school.",
        photoUrl: "/demo/speakers/maya-chen.svg",
      }),
      event: shapePortalEvent({
        name: "Teaching institute",
        dates: "Mar 1 – 2, 2027",
        timezone: "America/Los_Angeles",
        displayLogoUrl: null,
        brandColor: null,
        startDate: "2027-03-01T17:00:00.000Z",
        endDate: "2027-03-02T21:00:00.000Z",
        venueName: "Riverside Learning Center",
        slug: "demo",
      }),
      sessions: [
        {
          id: "sess_1",
          ...shapePortalSessionDetail({
            description: "How organizers reduce noise without losing energy.",
            trackName: "Keynote",
            trackColor: "#0033A0",
            format: "keynote",
            zoomLink: null,
            items: [
              {
                title: "What a calm learning day actually protects",
                abstract: "Which parts of the day can go quiet.",
                authors: paperAuthors,
              },
            ],
          }),
          attendees: [shapeDirectoryVisibleAttendee(leaked)],
        },
      ],
    };
    const raw = JSON.stringify(payload);
    expect(raw).not.toMatch(/"email"/);
    expect(raw).not.toMatch(/"userId"/);
    expect(identityKeys(payload)).toEqual([]);
    expect(raw).not.toMatch(/joinMode/);
    expect(raw).not.toContain("priya.shah@demo.readyhall.com");
    expect(raw).not.toContain("user_1");
    expect(raw).not.toContain("spk_1");
    expect(payload.sessions[0]!.attendees[0]).toEqual({
      displayName: "Priya Shah",
      title: "Grade 4 teacher",
      affiliation: "Riverside School District",
      photoUrl: "/demo/speakers/priya-shah.svg",
    });
  });

  it("keeps a directory name that has no title or photo in the old shape", () => {
    expect(
      shapeDirectoryVisibleAttendee({
        name: "Visible Joiner",
        affiliation: "Riverside",
        title: null,
        photoUrl: "  ",
      }),
    ).toEqual({ displayName: "Visible Joiner", affiliation: "Riverside" });
  });

  it("gives Maya a bio, both of her sessions a description, and the keynote a paper", () => {
    const spec = buildDemoFixtureSpec("public_demo");
    const maya = spec.speakers.find((speaker) => speaker.name === "Maya Chen");
    expect(maya?.bio.trim().length).toBeGreaterThan(80);
    const hers = spec.sessions.filter((session) => session.speakerKeys.includes("maya"));
    expect(hers).toHaveLength(2);
    for (const session of hers) expect(session.description.trim().length).toBeGreaterThan(0);
    const keynote = hers.find((session) => session.title.startsWith("Opening keynote"));
    expect(keynote?.items).toHaveLength(1);
    expect(keynote?.items?.[0]?.abstract.trim().length).toBeGreaterThan(0);
    expect(keynote?.items?.[0]?.authors).toHaveLength(2);
    expect(keynote?.items?.[0]?.authors.some((author) => author.isPresenter)).toBe(true);
    expect(DEMO_ROSTER_JOINERS.map((joiner) => joiner.name).sort()).toEqual(
      ["Priya Shah", "Sam Ortiz", "Tom Hale"].sort(),
    );
    for (const joiner of DEMO_ROSTER_JOINERS) {
      expect(joiner.title.trim().length).toBeGreaterThan(0);
      expect(joiner.affiliation.trim().length).toBeGreaterThan(0);
      expect(joiner.photoUrl).toMatch(/^\/demo\/speakers\/.+\.svg$/);
    }
  });
});
