import { describe, expect, it } from "vitest";
import {
  countSelectedOutreach,
  outreachImportSummaryLine,
  selectedOutreachRows,
} from "../lib/outreachImport";

const rows = [
  { kind: "create", rowIndex: 0, orgName: "Acme" },
  { kind: "create", rowIndex: 1, orgName: "Northbridge", contactEmail: "n@nb.edu" },
  { kind: "error", rowIndex: 2, message: "Already in this pipeline" },
];

describe("SPX-0 outreach import selection", () => {
  it("defaults every create row to selected", () => {
    expect(countSelectedOutreach(rows, {})).toBe(2);
    expect(selectedOutreachRows(rows, {}).map((r) => r.orgName)).toEqual(["Acme", "Northbridge"]);
  });

  it("honors unchecked rows and ignores errors", () => {
    expect(countSelectedOutreach(rows, { 0: false })).toBe(1);
    expect(selectedOutreachRows(rows, { 0: false })).toEqual([
      { orgName: "Northbridge", contactEmail: "n@nb.edu" },
    ]);
  });

  it("never claims an email was sent", () => {
    expect(outreachImportSummaryLine({ createdCount: 3 })).toBe(
      "Added 3 prospects. Nothing was emailed.",
    );
    expect(outreachImportSummaryLine({ createdCount: 1, skipped: [{ orgName: "X", reason: "dup" }] })).toMatch(
      /Nothing was emailed/,
    );
  });
});
