/**
 * GROUND-1 — the Event assistant's corpus is scoped like the attendee agenda.
 * A DRAFT session lives on the event but must never reach the grounding text,
 * and therefore never reaches the model or the grounded id sets that gate
 * mutations. Managers keep the drafts they can already see on the Program tab.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventStatus, SessionPublishStatus } from "@prisma/client";

type SessionRow = { id: string; title: string; publishStatus: SessionPublishStatus };

const state: { eventStatus: EventStatus; sessions: SessionRow[] } = {
  eventStatus: EventStatus.ACTIVE,
  sessions: [],
};

vi.mock("../lib/db", () => {
  /** Enough of Prisma's where semantics for the nested sessions select: the
   *  publishStatus equality and the `event: { status }` relation filter. An
   *  absent where means the query asked for everything. */
  const visible = (
    row: SessionRow,
    where?: { publishStatus?: SessionPublishStatus; event?: { status?: EventStatus } },
  ): boolean => {
    if (!where) return true;
    if (where.publishStatus !== undefined && row.publishStatus !== where.publishStatus) return false;
    if (where.event?.status !== undefined && state.eventStatus !== where.event.status) return false;
    return true;
  };

  return {
    prisma: {
      event: {
        findUnique: async ({
          select,
        }: {
          select: { sessions: { where?: Parameters<typeof visible>[1] } };
        }) => ({
          id: "evt_1",
          name: "Ground Test Event",
          timezone: "UTC",
          startDate: new Date("2027-06-01T00:00:00Z"),
          endDate: new Date("2027-06-03T00:00:00Z"),
          description: null,
          organizationId: "org_1",
          sessions: state.sessions
            .filter((row) => visible(row, select.sessions.where))
            .map((row) => ({
              id: row.id,
              title: row.title,
              startsAt: new Date("2027-06-02T15:00:00Z"),
              endsAt: new Date("2027-06-02T16:00:00Z"),
              roomId: null,
              trackId: null,
              description: null,
              speakers: null,
              sessionSpeakers: [],
              items: [],
            })),
          rooms: [],
          tracks: [],
          speakersRoster: [],
          announcements: [],
          eventFaqs: [],
          venueMaps: [],
        }),
      },
      sessionAttendance: { findMany: async () => [] },
    },
  };
});

import { assertGroundedIds, buildEventGroundingContext } from "../lib/ai/grounding";

const PUBLISHED_TITLE = "Opening Keynote";
const DRAFT_TITLE = "Unannounced Restructure Briefing";

describe("Event assistant grounding — session visibility (unit)", () => {
  beforeEach(() => {
    state.eventStatus = EventStatus.ACTIVE;
    state.sessions = [
      { id: "ses_pub", title: PUBLISHED_TITLE, publishStatus: SessionPublishStatus.PUBLISHED },
      { id: "ses_draft", title: DRAFT_TITLE, publishStatus: SessionPublishStatus.DRAFT },
    ];
  });

  it("an attendee's corpus carries the published session and not the draft", async () => {
    const grounding = await buildEventGroundingContext("evt_1", { userId: "usr_attendee" });

    expect(grounding.textBlob).toContain(PUBLISHED_TITLE);
    expect(grounding.textBlob).not.toContain(DRAFT_TITLE);
    expect(grounding.sessions.map((s) => s.title)).toEqual([PUBLISHED_TITLE]);
    expect(grounding.sessionIds.has("ses_pub")).toBe(true);
    expect(grounding.sessionIds.has("ses_draft")).toBe(false);
  });

  it("a draft id is out of the corpus, so it cannot be smuggled into a mutation", async () => {
    const grounding = await buildEventGroundingContext("evt_1", { userId: "usr_attendee" });

    expect(() => assertGroundedIds(grounding, { sessionIds: ["ses_pub"] })).not.toThrow();
    expect(() => assertGroundedIds(grounding, { sessionIds: ["ses_draft"] })).toThrow(
      /Foreign sessionId/,
    );
  });

  it("omitting the manage flag gets the attendee-safe corpus, not everything", async () => {
    const grounding = await buildEventGroundingContext("evt_1");

    expect(grounding.textBlob).not.toContain(DRAFT_TITLE);
  });

  it("a draft is withheld on an event that is not yet ACTIVE, along with the rest", async () => {
    state.eventStatus = EventStatus.DRAFT;
    const grounding = await buildEventGroundingContext("evt_1", { userId: "usr_attendee" });

    expect(grounding.sessions).toEqual([]);
    expect(grounding.textBlob).not.toContain(DRAFT_TITLE);
    expect(grounding.textBlob).not.toContain(PUBLISHED_TITLE);
  });

  it("a manager still sees drafts — organizer surfaces are unchanged", async () => {
    const grounding = await buildEventGroundingContext("evt_1", {
      userId: "usr_admin",
      canManageEvent: true,
    });

    expect(grounding.textBlob).toContain(DRAFT_TITLE);
    expect(grounding.sessionIds.has("ses_draft")).toBe(true);

    // And on a not-yet-ACTIVE event, where the attendee corpus is empty.
    state.eventStatus = EventStatus.DRAFT;
    const onDraftEvent = await buildEventGroundingContext("evt_1", {
      userId: "usr_admin",
      canManageEvent: true,
    });
    expect(onDraftEvent.sessions.map((s) => s.title)).toEqual([PUBLISHED_TITLE, DRAFT_TITLE]);
  });
});
