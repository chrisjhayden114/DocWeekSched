/**
 * SPK-1 — the Speakers tab's view model: the readiness chip text, the portal
 * state the API never sends, and the delete cascade copy whose counts have to
 * be right or the confirmation is a lie.
 */

import { describe, expect, it } from "vitest";
import {
  PORTAL_STATE_LABELS,
  accessesBySpeakerId,
  filterSpeakers,
  isCfpConverted,
  portalCell,
  portalStateFor,
  readinessChip,
  rollupsBySpeakerId,
  sessionsCellText,
  shouldShowSpeakerFilter,
  speakerCascadeCounts,
  speakerDeleteCascadeCopy,
  speakerDeleteTitle,
  speakerSessions,
  type SpeakerPortalAccess,
  type SpeakerRow,
} from "../lib/speakersView";
import type { SubjectRollup } from "../lib/readinessView";

const NOW = Date.parse("2026-06-01T12:00:00Z");

function speaker(over: Partial<SpeakerRow> = {}): SpeakerRow {
  return { id: "spk1", name: "Ada Lovelace", ...over };
}

function rollup(over: Partial<SubjectRollup> = {}): SubjectRollup {
  return { total: 0, ready: 0, waived: 0, open: 0, late: 0, complete: false, ...over };
}

function access(over: Partial<SpeakerPortalAccess> = {}): SpeakerPortalAccess {
  return {
    id: "pa1",
    speakerId: "spk1",
    email: "ada@example.edu",
    invitedAt: "2026-05-01T00:00:00Z",
    expiresAt: "2026-07-01T00:00:00Z",
    revokedAt: null,
    lastUsedAt: null,
    ...over,
  };
}

describe("readiness chip", () => {
  it("reads counts only: 3/4 ready (+1 late)", () => {
    expect(readinessChip(rollup({ total: 4, ready: 3, open: 1, late: 1 }))?.label).toBe(
      "3/4 ready (+1 late)",
    );
  });

  it("drops the late clause when nothing is late", () => {
    expect(readinessChip(rollup({ total: 4, ready: 3, open: 1 }))?.label).toBe("3/4 ready");
  });

  it("counts waived items as part of the total, not as ready", () => {
    // The server settles WAIVED without counting it ready; the chip must not
    // round it up into a green 4/4.
    expect(
      readinessChip(rollup({ total: 4, ready: 3, waived: 1, open: 0, complete: true }))?.label,
    ).toBe("3/4 ready");
  });

  it("is null when the speaker has no rollup — the cell shows an em dash", () => {
    expect(readinessChip(null)).toBeNull();
    expect(readinessChip(undefined)).toBeNull();
  });

  it("is null for a zero-requirement rollup rather than showing 0/0", () => {
    expect(readinessChip(rollup())).toBeNull();
  });

  it("tones: late amber, complete green, started accent, untouched gray", () => {
    expect(readinessChip(rollup({ total: 2, ready: 1, late: 1 }))?.tone).toBe("pending");
    expect(readinessChip(rollup({ total: 2, ready: 2, complete: true }))?.tone).toBe("published");
    expect(readinessChip(rollup({ total: 2, ready: 1, open: 1 }))?.tone).toBe("progress");
    expect(readinessChip(rollup({ total: 2, open: 2 }))?.tone).toBe("default");
  });

  it("indexes only speaker subjects, never sessions sharing an id", () => {
    const map = rollupsBySpeakerId([
      { type: "speaker", id: "spk1", rollup: rollup({ total: 2, ready: 2 }) },
      { type: "session", id: "spk1", rollup: rollup({ total: 9, ready: 9 }) },
    ]);
    expect(map.get("spk1")?.total).toBe(2);
  });
});

describe("portal state", () => {
  it("no row at all is No invite", () => {
    expect(portalStateFor(null, NOW)).toBe("none");
  });

  it("sent but untouched is Invited", () => {
    expect(portalStateFor(access(), NOW)).toBe("invited");
  });

  it("lastUsedAt means they Opened it", () => {
    expect(portalStateFor(access({ lastUsedAt: "2026-05-02T00:00:00Z" }), NOW)).toBe("opened");
  });

  it("a past expiry is Expired", () => {
    expect(portalStateFor(access({ expiresAt: "2026-05-30T00:00:00Z" }), NOW)).toBe("expired");
  });

  it("Revoked beats expired and opened — the organizer's own act wins", () => {
    expect(
      portalStateFor(
        access({
          revokedAt: "2026-05-20T00:00:00Z",
          expiresAt: "2026-05-30T00:00:00Z",
          lastUsedAt: "2026-05-02T00:00:00Z",
        }),
        NOW,
      ),
    ).toBe("revoked");
  });

  it("Expired beats opened — a used link that lapsed still needs a remint", () => {
    expect(
      portalStateFor(
        access({ expiresAt: "2026-05-30T00:00:00Z", lastUsedAt: "2026-05-02T00:00:00Z" }),
        NOW,
      ),
    ).toBe("expired");
  });

  it("an unparseable expiry never invents an expiry", () => {
    expect(portalStateFor(access({ expiresAt: "not-a-date" }), NOW)).toBe("invited");
  });

  it("the cell carries the label, tone and the read-only email", () => {
    expect(portalCell(access({ lastUsedAt: "2026-05-02T00:00:00Z" }), NOW)).toEqual({
      state: "opened",
      label: "Opened",
      tone: "published",
      email: "ada@example.edu",
    });
    expect(portalCell(null, NOW)).toEqual({
      state: "none",
      label: PORTAL_STATE_LABELS.none,
      tone: "default",
      email: null,
    });
  });

  it("indexes access rows by speaker", () => {
    const map = accessesBySpeakerId([access(), access({ id: "pa2", speakerId: "spk2" })]);
    expect(map.get("spk2")?.id).toBe("pa2");
    expect(map.get("spk3")).toBeUndefined();
  });
});

describe("sessions cell", () => {
  const sessions = [
    { id: "s1", title: "Opening keynote" },
    { id: "s2", title: "Panel: assessment" },
  ];

  it("orders by the organizer's sortOrder and names the first", () => {
    const row = speaker({
      sessions: [
        { sessionId: "s2", sortOrder: 1 },
        { sessionId: "s1", sortOrder: 0 },
      ],
    });
    expect(speakerSessions(row, sessions).map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(sessionsCellText(row, sessions)).toBe("2 sessions · Opening keynote");
  });

  it("singular for one", () => {
    const row = speaker({ sessions: [{ sessionId: "s1", sortOrder: 0 }] });
    expect(sessionsCellText(row, sessions)).toBe("1 session · Opening keynote");
  });

  it("drops links to sessions this event no longer has", () => {
    const row = speaker({
      sessions: [
        { sessionId: "s1", sortOrder: 0 },
        { sessionId: "gone", sortOrder: 1 },
      ],
    });
    expect(sessionsCellText(row, sessions)).toBe("1 session · Opening keynote");
  });

  it("is null with no links", () => {
    expect(sessionsCellText(speaker(), sessions)).toBeNull();
  });
});

describe("CFP badge", () => {
  it("shows only for a converted speaker", () => {
    expect(isCfpConverted(speaker())).toBe(false);
    expect(isCfpConverted(speaker({ _count: { cfpConversions: 0 } }))).toBe(false);
    expect(isCfpConverted(speaker({ _count: { cfpConversions: 1 } }))).toBe(true);
  });
});

describe("delete cascade copy", () => {
  const sessions = [
    { id: "s1", title: "Opening keynote" },
    { id: "s2", title: "Panel: assessment" },
  ];

  it("titles with the speaker's name in curly quotes", () => {
    expect(speakerDeleteTitle("Ada Lovelace")).toBe("Delete \u201cAda Lovelace\u201d?");
  });

  it("counts sessions, assignments, submissions, portal and CFP from client data", () => {
    const counts = speakerCascadeCounts({
      speaker: speaker({
        sessions: [
          { sessionId: "s1", sortOrder: 0 },
          { sessionId: "s2", sortOrder: 1 },
        ],
        _count: { cfpConversions: 1 },
      }),
      sessions,
      assignments: [
        { speakerId: "spk1", latestSubmission: { id: "sub1" } },
        { speakerId: "spk1", latestSubmission: null },
        { speakerId: "spk1", latestSubmission: { id: "sub2" } },
        { speakerId: "other", latestSubmission: { id: "sub3" } },
        { speakerId: null, latestSubmission: { id: "sub4" } },
      ],
      access: access(),
    });

    expect(counts).toEqual({
      sessions: 2,
      readinessAssignments: 3,
      submittedMaterials: 2,
      portalAccess: true,
      cfpSubmissions: 1,
      readinessKnown: true,
    });
  });

  it("names every consequence, in blast-radius order", () => {
    const body = speakerDeleteCascadeCopy({
      sessions: 2,
      readinessAssignments: 3,
      submittedMaterials: 2,
      portalAccess: true,
      cfpSubmissions: 1,
      readinessKnown: true,
    });

    expect(body).toBe(
      "2 sessions lose this speaker but stay on the schedule. " +
        "3 readiness assignments and 2 submitted items — including uploaded files — are deleted. " +
        "Their presenter portal link stops working immediately. " +
        "The CFP submission they were converted from is kept, but no longer linked to a speaker. " +
        "This can't be undone.",
    );
  });

  it("says nothing has been submitted rather than implying files are lost", () => {
    const body = speakerDeleteCascadeCopy({
      sessions: 0,
      readinessAssignments: 2,
      submittedMaterials: 0,
      portalAccess: false,
      cfpSubmissions: 0,
      readinessKnown: true,
    });
    expect(body).toBe(
      "2 readiness assignments are deleted; nothing has been submitted against them yet. " +
        "This can't be undone.",
    );
  });

  it("agrees in number for a single session, assignment and submission", () => {
    const body = speakerDeleteCascadeCopy({
      sessions: 1,
      readinessAssignments: 1,
      submittedMaterials: 1,
      portalAccess: false,
      cfpSubmissions: 0,
      readinessKnown: true,
    });
    expect(body).toBe(
      "1 session loses this speaker but stays on the schedule. " +
        "1 readiness assignment and 1 submitted item — including uploaded files — are deleted. " +
        "This can't be undone.",
    );
  });

  it("without readiness data, admits the counts are unknown instead of claiming zero", () => {
    const counts = speakerCascadeCounts({
      speaker: speaker(),
      sessions,
      assignments: null,
      access: null,
    });
    expect(counts.readinessKnown).toBe(false);
    expect(speakerDeleteCascadeCopy(counts)).toBe(
      "Any readiness assignments, submitted materials and portal access are deleted too — " +
        "those counts aren't loaded, so they aren't listed here. This can't be undone.",
    );
  });

  it("suppresses the portal clause when readiness data is missing — it can't be known", () => {
    const body = speakerDeleteCascadeCopy({
      sessions: 0,
      readinessAssignments: 0,
      submittedMaterials: 0,
      portalAccess: true,
      cfpSubmissions: 0,
      readinessKnown: false,
    });
    expect(body).not.toContain("portal link stops working");
    expect(body).toContain("aren't loaded");
  });

  it("still warns when a speaker is linked to nothing at all", () => {
    expect(
      speakerDeleteCascadeCopy({
        sessions: 0,
        readinessAssignments: 0,
        submittedMaterials: 0,
        portalAccess: false,
        cfpSubmissions: 0,
        readinessKnown: true,
      }),
    ).toBe("Nothing else in this event is linked to this speaker. This can't be undone.");
  });

  it("pluralises multiple CFP submissions", () => {
    expect(
      speakerDeleteCascadeCopy({
        sessions: 0,
        readinessAssignments: 0,
        submittedMaterials: 0,
        portalAccess: false,
        cfpSubmissions: 2,
        readinessKnown: true,
      }),
    ).toContain("The 2 CFP submissions they were converted from are kept");
  });
});

describe("name filter", () => {
  const rows = [speaker(), speaker({ id: "spk2", name: "Grace Hopper" })];

  it("appears only past ten speakers", () => {
    expect(shouldShowSpeakerFilter(10)).toBe(false);
    expect(shouldShowSpeakerFilter(11)).toBe(true);
  });

  it("matches case-insensitively on any part of the name", () => {
    expect(filterSpeakers(rows, "hopper").map((r) => r.id)).toEqual(["spk2"]);
    expect(filterSpeakers(rows, "  ADA ").map((r) => r.id)).toEqual(["spk1"]);
  });

  it("an empty query keeps every row", () => {
    expect(filterSpeakers(rows, "   ")).toHaveLength(2);
  });
});
