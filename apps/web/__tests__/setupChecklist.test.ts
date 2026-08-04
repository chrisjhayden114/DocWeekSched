import { describe, expect, it } from "vitest";
import {
  buildSetupChecklist,
  nextSetupStep,
  type SetupChecklistInput,
} from "../lib/setupChecklist";

const EMPTY_EVENT: SetupChecklistInput = {
  eventId: "ev1",
  status: "DRAFT",
  venueName: null,
  onlineUrl: null,
  sessionCount: 0,
  draftSessionCount: 0,
  roomCount: 0,
  speakerCount: 0,
};

describe("E19.3 — Setup assistant checklist", () => {
  it("names 'add sessions' as the next step for a brand-new event", () => {
    const next = nextSetupStep(buildSetupChecklist(EMPTY_EVENT));
    expect(next?.key).toBe("sessions");
    expect(next?.href).toBe("/organizer/events/ev1?tab=program");
  });

  it("every incomplete item deep-links into the console", () => {
    for (const item of buildSetupChecklist(EMPTY_EVENT)) {
      expect(item.href).toMatch(/^\/organizer\/events\/ev1\?tab=(program|people|overview)$/);
      expect(item.linkLabel.length).toBeGreaterThan(0);
    }
  });

  it("walks forward as state fills in: rooms, speakers, venue, publish", () => {
    const withSessions = { ...EMPTY_EVENT, sessionCount: 12 };
    expect(nextSetupStep(buildSetupChecklist(withSessions))?.key).toBe("rooms");

    const withRooms = { ...withSessions, roomCount: 3 };
    expect(nextSetupStep(buildSetupChecklist(withRooms))?.key).toBe("speakers");

    const withSpeakers = { ...withRooms, speakerCount: 5 };
    expect(nextSetupStep(buildSetupChecklist(withSpeakers))?.key).toBe("venue");

    const withVenue = { ...withSpeakers, venueName: "Aula Conference Centre" };
    expect(nextSetupStep(buildSetupChecklist(withVenue))?.key).toBe("publish");
  });

  it("an online URL satisfies the venue step", () => {
    const online = { ...EMPTY_EVENT, sessionCount: 1, roomCount: 1, speakerCount: 1, onlineUrl: "https://example.com/live" };
    expect(nextSetupStep(buildSetupChecklist(online))?.key).toBe("publish");
  });

  it("surfaces draft sessions before publish, with a count", () => {
    const input = {
      ...EMPTY_EVENT,
      sessionCount: 10,
      draftSessionCount: 4,
      roomCount: 2,
      speakerCount: 3,
      venueName: "Main Hall",
    };
    const next = nextSetupStep(buildSetupChecklist(input));
    expect(next?.key).toBe("draft-sessions");
    expect(next?.detail).toContain("4 sessions are still draft");
  });

  it("reports complete when everything is in place and the event is live", () => {
    const done = {
      ...EMPTY_EVENT,
      status: "ACTIVE",
      sessionCount: 10,
      roomCount: 2,
      speakerCount: 3,
      venueName: "Main Hall",
    };
    const items = buildSetupChecklist(done);
    expect(nextSetupStep(items)).toBeNull();
    expect(items.every((i) => i.done)).toBe(true);
  });
});
