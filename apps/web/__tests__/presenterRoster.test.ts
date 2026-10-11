import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PresenterRosterSession } from "@event-app/shared";
import {
  PRESENTER_PORTAL_SESSIONS_TITLE,
  PRESENTER_ROSTER_EMPTY,
  SESSION_PAGE_PRESENTER_ROSTER_TITLE,
  hasPresenterRosterNames,
  presenterRosterHiddenLine,
  presenterRosterJoinedLine,
  presenterRosterWaitlistLine,
} from "../lib/presenterRoster";

const countsSession: PresenterRosterSession = {
  id: "s1",
  title: "Opening keynote",
  startsAt: "2027-03-01T17:00:00.000Z",
  endsAt: "2027-03-01T18:00:00.000Z",
  roomName: "Hall A",
  joinedCount: 42,
  inPersonCapacity: 60,
  virtualCapacity: null,
  waitlistCount: 3,
};

describe("presenter roster view model", () => {
  it("uses the copy the portal and session page render", () => {
    expect(PRESENTER_PORTAL_SESSIONS_TITLE).toBe("Your sessions");
    expect(SESSION_PAGE_PRESENTER_ROSTER_TITLE).toBe("You're presenting this session");
    expect(PRESENTER_ROSTER_EMPTY).toBe("Nobody has added this session yet.");
  });

  it("formats joined / capacity / waitlist the way the card shows them", () => {
    expect(presenterRosterJoinedLine(countsSession)).toBe("42 of 60 seats");
    expect(presenterRosterWaitlistLine(3)).toBe("+3 waiting");
    expect(presenterRosterWaitlistLine(0)).toBeNull();
    expect(
      presenterRosterJoinedLine({
        ...countsSession,
        inPersonCapacity: null,
        virtualCapacity: null,
        joinedCount: 5,
      }),
    ).toBe("5 joined");
  });

  it("names the private remainder without inventing a person", () => {
    expect(presenterRosterHiddenLine(0)).toBeNull();
    expect(presenterRosterHiddenLine(1)).toBe("and 1 more who keeps their profile private");
    expect(presenterRosterHiddenLine(4)).toBe("and 4 more who keep their profile private");
  });

  it("treats a missing attendees array as COUNTS, not an empty NAMES list", () => {
    expect(hasPresenterRosterNames(countsSession)).toBe(false);
    expect(hasPresenterRosterNames({ ...countsSession, attendees: [] })).toBe(true);
  });

  it("the directory opt-in help tells attendees presenters may see their name", () => {
    const sentence = "Presenters of sessions you join may see your name when the organizer allows it.";
    const profile = readFileSync(join(__dirname, "../components/ProfileEditor.tsx"), "utf8");
    const welcome = readFileSync(join(__dirname, "../components/WelcomeFlow.tsx"), "utf8");
    expect(profile).toContain(sentence);
    expect(welcome).toContain(sentence);
    expect(profile).toContain("Show me in this event");
  });
});
