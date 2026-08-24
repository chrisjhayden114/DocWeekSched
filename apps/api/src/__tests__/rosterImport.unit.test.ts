/**
 * W-2 ROSTER-IMPORT — the two pure decisions the flow rests on:
 *   1) a mapped CSV label column is validated against the event's own labels,
 *      and an unknown value is a visible row error (never a silent drop);
 *   2) a seat added without an email derives the NOT_INVITED state, while every
 *      pre-W-2 row keeps deriving exactly what it derived before.
 */

import { describe, expect, it } from "vitest";
import { dryRunCsvInvites, matchEventLabel, suggestCsvMapping } from "../lib/csvInviteDryRun";
import { deriveInviteStatus, needsInvite } from "../lib/inviteStatus";

const EVENT_LABELS = ["Class of 2028", "Science Dept"];

describe("W-2 — label column mapping", () => {
  it("accepts an event label and stores the event's own casing", () => {
    const result = dryRunCsvInvites({
      headers: ["email", "name", "label"],
      rows: [{ email: "ada@example.edu", name: "Ada", label: "science dept" }],
      eventLabels: EVENT_LABELS,
    });
    expect(result.summary.errors).toBe(0);
    const create = result.rows.find((r) => r.kind === "create");
    expect(create?.kind === "create" && create.participantLabel).toBe("Science Dept");
  });

  it("an unknown label is a row error, not a dropped value", () => {
    const result = dryRunCsvInvites({
      headers: ["email", "name", "label"],
      rows: [
        { email: "ada@example.edu", name: "Ada", label: "Class of 2028" },
        { email: "grace@example.edu", name: "Grace", label: "Robotics Club" },
      ],
      eventLabels: EVENT_LABELS,
    });
    expect(result.summary.creates).toBe(1);
    expect(result.summary.errors).toBe(1);
    const error = result.rows.find((r) => r.kind === "error");
    expect(error?.kind === "error" && error.message).toMatch(/Robotics Club/);
    expect(error?.kind === "error" && error.message).toMatch(/Class of 2028, Science Dept/);
    // The rejected row is reported with its source data, so it can be fixed.
    expect(error?.kind === "error" && error.raw?.email).toBe("grace@example.edu");
  });

  it("a label column mapped by hand on an event with no labels errors instead of inventing one", () => {
    const result = dryRunCsvInvites({
      headers: ["email", "label"],
      rows: [{ email: "ada@example.edu", label: "Science Dept" }],
      mapping: { email: "email", label: "label" },
      eventLabels: [],
    });
    expect(result.summary.creates).toBe(0);
    const error = result.rows.find((r) => r.kind === "error");
    expect(error?.kind === "error" && error.message).toMatch(/no participant labels yet/i);
  });

  it("an empty label cell is simply no label", () => {
    const result = dryRunCsvInvites({
      headers: ["email", "name", "label"],
      rows: [{ email: "ada@example.edu", name: "Ada", label: "  " }],
      eventLabels: EVENT_LABELS,
    });
    expect(result.summary.errors).toBe(0);
    const create = result.rows.find((r) => r.kind === "create");
    expect(create?.kind === "create" && create.participantLabel).toBeUndefined();
  });

  it("suggests a label column only when the event defines labels", () => {
    expect(suggestCsvMapping(["Email", "Label"], EVENT_LABELS).Label).toBe("label");
    expect(suggestCsvMapping(["Email", "Label"]).Label).toBe("skip");
    // An unrelated column must not become a wall of unknown-label errors.
    expect(suggestCsvMapping(["Email", "Department"], EVENT_LABELS).Department).toBe("skip");
  });

  it("matchEventLabel reports rather than guesses", () => {
    expect(matchEventLabel("Science Dept", EVENT_LABELS)).toEqual({
      ok: true,
      label: "Science Dept",
    });
    expect(matchEventLabel("Nope", EVENT_LABELS).ok).toBe(false);
  });
});

describe("W-2 — NOT_INVITED derivation", () => {
  const now = new Date("2026-08-24T12:00:00Z");

  it("a seat added with no email reads Not invited", () => {
    expect(
      deriveInviteStatus(
        {
          profileSetupTokenHash: null,
          profileSetupTokenExpiresAt: null,
          addedWithoutInviteAt: new Date("2026-08-24T11:00:00Z"),
        },
        now,
      ),
    ).toBe("NOT_INVITED");
  });

  it("sending the invite moves the same seat to Invite sent", () => {
    expect(
      deriveInviteStatus(
        {
          profileSetupTokenHash: "hash",
          profileSetupTokenExpiresAt: new Date("2026-08-31T12:00:00Z"),
          // sendInvite clears the marker; an outstanding token wins regardless.
          addedWithoutInviteAt: null,
        },
        now,
      ),
    ).toBe("PENDING_SETUP");
  });

  it("pre-W-2 rows are unaffected: no marker means the old three states", () => {
    const base = { addedWithoutInviteAt: null };
    expect(
      deriveInviteStatus({ ...base, profileSetupTokenHash: null, profileSetupTokenExpiresAt: null }, now),
    ).toBe("ACTIVE");
    expect(
      deriveInviteStatus(
        { ...base, profileSetupTokenHash: "h", profileSetupTokenExpiresAt: new Date("2026-09-01T00:00:00Z") },
        now,
      ),
    ).toBe("PENDING_SETUP");
    expect(
      deriveInviteStatus(
        { ...base, profileSetupTokenHash: "h", profileSetupTokenExpiresAt: new Date("2026-08-01T00:00:00Z") },
        now,
      ),
    ).toBe("INVITE_EXPIRED");
  });

  it("an expired invite on an imported seat still reads expired, not Not invited", () => {
    expect(
      deriveInviteStatus(
        {
          profileSetupTokenHash: "h",
          profileSetupTokenExpiresAt: new Date("2026-08-01T00:00:00Z"),
          addedWithoutInviteAt: new Date("2026-07-01T00:00:00Z"),
        },
        now,
      ),
    ).toBe("INVITE_EXPIRED");
  });

  it("only people who finished setup are skipped by a send-invites run", () => {
    expect(needsInvite("NOT_INVITED")).toBe(true);
    expect(needsInvite("INVITE_EXPIRED")).toBe(true);
    expect(needsInvite("PENDING_SETUP")).toBe(true);
    expect(needsInvite("ACTIVE")).toBe(false);
  });
});
