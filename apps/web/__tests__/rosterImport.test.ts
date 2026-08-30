import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bulkInviteFailureBreakdown,
  bulkInviteSummaryLine,
  countSelected,
  importSummaryLine,
  rowLabelValue,
  selectedImportRows,
  sendInvitesDetail,
  sendInvitesSummaryLine,
  summarizeSkipped,
  type ImportDryRunRow,
} from "../lib/rosterImport";

/**
 * W-2 ROSTER-IMPORT — the spreadsheet flow's selection, payload, and summary
 * copy. The copy tests exist because the whole point of the chunk is that the
 * UI never claims an email it didn't send.
 */

const rows: ImportDryRunRow[] = [
  { kind: "create", rowIndex: 0, email: "ada@example.edu", name: "Ada" },
  { kind: "create", rowIndex: 1, email: "grace@example.edu", name: "Grace", participantLabel: "Science Dept" },
  { kind: "error", rowIndex: 2, message: "Missing email" },
  { kind: "create", rowIndex: 3, email: "alan@example.edu", name: "Alan" },
];

describe("W-2 — row selection", () => {
  it("defaults every valid row to selected", () => {
    expect(selectedImportRows(rows, {}).map((r) => r.email)).toEqual([
      "ada@example.edu",
      "grace@example.edu",
      "alan@example.edu",
    ]);
    expect(countSelected(rows, {})).toBe(3);
  });

  it("drops only the rows explicitly unticked", () => {
    const selected = selectedImportRows(rows, { 0: false, 3: true });
    expect(selected.map((r) => r.email)).toEqual(["grace@example.edu", "alan@example.edu"]);
    expect(countSelected(rows, { 0: false })).toBe(2);
  });

  it("carries the CSV's label and lets a per-row choice override it", () => {
    const selected = selectedImportRows(rows, {}, { 0: "Class of 2028", 1: "" });
    expect(selected[0]).toMatchObject({ email: "ada@example.edu", participantLabel: "Class of 2028" });
    // Grace's CSV label was cleared by hand — cleared means no label, not the CSV value.
    expect(selected[1]).toMatchObject({ email: "grace@example.edu", participantLabel: null });
    expect(selected[2]).toMatchObject({ email: "alan@example.edu", participantLabel: null });
  });

  it("the row select shows the override, else the CSV value, else nothing", () => {
    expect(rowLabelValue(rows[1], {})).toBe("Science Dept");
    expect(rowLabelValue(rows[1], { 1: "Class of 2028" })).toBe("Class of 2028");
    expect(rowLabelValue(rows[1], { 1: "" })).toBe("");
    expect(rowLabelValue(rows[0], {})).toBe("");
  });
});

describe("W-2 — summary copy tells the truth about emails", () => {
  it("adding to the roster says no emails were sent", () => {
    expect(importSummaryLine({ createdCount: 25 })).toBe(
      "Added 25 people to the roster. No emails sent.",
    );
  });

  it("adding and inviting says both, with the count that actually went out", () => {
    expect(
      importSummaryLine(
        { createdCount: 25 },
        { sentCount: 25, failedCount: 0, alreadyActiveCount: 0 },
      ),
    ).toBe("Added 25 people to the roster and sent 25 invites.");
  });

  it("never claims invites when none were sent", () => {
    const line = importSummaryLine(
      { createdCount: 3 },
      { sentCount: 0, failedCount: 3, alreadyActiveCount: 0 },
    );
    expect(line).toContain("No invites went out.");
    expect(line).toContain("3 invites couldn't be sent");
  });

  it("surfaces the partial-failure breakdown instead of dropping it (J-A #13)", () => {
    const detail = sendInvitesDetail({
      sentCount: 20,
      failedCount: 2,
      alreadyActiveCount: 3,
      undelivered: true,
    });
    expect(detail).toHaveLength(3);
    expect(detail[0]).toMatch(/2 invites couldn't be sent/);
    expect(detail[1]).toMatch(/3 already finished setup/);
    expect(detail[2]).toMatch(/Email delivery isn't set up/);
  });

  it("groups skipped rows by reason", () => {
    expect(
      summarizeSkipped([
        { email: "a@x.edu", reason: "Already on the roster" },
        { email: "b@x.edu", reason: "Already on the roster" },
        { email: "c@x.edu", reason: "Invalid email" },
      ]),
    ).toBe("2 already on the roster, 1 invalid email");
    expect(
      importSummaryLine({
        createdCount: 1,
        skipped: [{ email: "a@x.edu", reason: "Already on the roster" }],
      }),
    ).toBe("Added 1 person to the roster. No emails sent. 1 skipped: 1 already on the roster.");
  });

  it("the roster bulk bar reports its own run honestly", () => {
    expect(
      sendInvitesSummaryLine({ sentCount: 1, failedCount: 0, alreadyActiveCount: 0 }),
    ).toBe("Sent 1 invite.");
    expect(
      sendInvitesSummaryLine({ sentCount: 0, failedCount: 0, alreadyActiveCount: 2 }),
    ).toBe("No invites were sent. 2 already finished setup, so no email was sent to them.");
  });
});

describe("W-6 — bulk-invite partial-failure breakdown", () => {
  it("keeps every failed row and why", () => {
    const failed = bulkInviteFailureBreakdown([
      { email: "ada@example.edu", error: "Already on the roster" },
      { email: "bad@", error: "Invalid email" },
    ]);
    expect(failed).toEqual([
      { email: "ada@example.edu", error: "Already on the roster" },
      { email: "bad@", error: "Invalid email" },
    ]);
    expect(
      bulkInviteSummaryLine({
        sentCount: 4,
        failedCount: 2,
        failed,
      }),
    ).toMatch(/2 invites couldn't be sent — see the list below/);
  });

  it("the dashboard bulk-invite card renders the per-row list", () => {
    const dash = readFileSync(join(__dirname, "..", "pages", "dashboard.tsx"), "utf8");
    expect(dash).toContain("bulkInviteFailureBreakdown");
    expect(dash).toContain("bulkInviteSummaryLine");
    expect(dash).toContain("{row.email ? `${row.email} — ` : null}");
    expect(dash).toContain("{row.error}");
  });
});

describe("W-2 — the Participants tab wires the two-step flow", () => {
  const webDir = join(__dirname, "..");
  const pageSrc = readFileSync(
    join(webDir, "pages", "organizer", "events", "[eventId]", "index.tsx"),
    "utf8",
  );
  const cardSrc = readFileSync(
    join(webDir, "components", "organizer", "RosterImportCard.tsx"),
    "utf8",
  );

  it("the CSV card offers both actions and no longer posts to invite-bulk", () => {
    expect(cardSrc).toContain('"/attendees/import"');
    expect(cardSrc).toContain('"/attendees/send-invites"');
    expect(cardSrc).toContain("Add and send");
    expect(cardSrc).not.toContain("invite-bulk");
    expect(pageSrc).not.toContain("invite-bulk");
  });

  it("rows are reviewable per row: checkboxes, select all, and a label select", () => {
    expect(cardSrc).toContain("onAcceptChange");
    expect(cardSrc).toContain("selectAll");
    expect(cardSrc).toContain("renderCreateExtra");
    expect(cardSrc).toContain("participantLabelSelectOptions(participantLabels)");
  });

  it("the roster can bulk-send invites and shows every per-item outcome", () => {
    expect(pageSrc).toContain("sendRosterInvites");
    expect(pageSrc).toContain("Send invites");
    expect(pageSrc).toContain("sendInvitesSummaryLine");
    expect(pageSrc).toContain("Select all participants");
    expect(pageSrc).toContain("inviteRun.items");
  });
});
