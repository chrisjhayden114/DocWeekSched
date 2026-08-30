import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EVENT_ORG_LOCKED_NOTE, eventCreationOrgMode } from "../lib/eventCreationOrg";

describe("W-6 — event-creation org picker", () => {
  it("hides the picker for a single organization", () => {
    expect(eventCreationOrgMode([{ id: "o1", name: "Northbridge" }])).toEqual({
      kind: "single",
      name: "Northbridge",
    });
  });

  it("shows the locked-org note when there is a choice", () => {
    expect(
      eventCreationOrgMode([
        { id: "o1", name: "Northbridge" },
        { id: "o2", name: "Harbor" },
      ]),
    ).toEqual({ kind: "picker", note: EVENT_ORG_LOCKED_NOTE });
    expect(EVENT_ORG_LOCKED_NOTE).toMatch(/can't move to a different organization later/);
  });

  it("the wizard uses the quiet line for one org and the note for many", () => {
    const page = readFileSync(join(__dirname, "..", "pages", "organizer", "events", "new.tsx"), "utf8");
    expect(page).toContain("Creating in {orgs[0]!.name}");
    expect(page).toContain("EVENT_ORG_LOCKED_NOTE");
    expect(page).toContain("if (orgs.length === 1)");
  });
});
