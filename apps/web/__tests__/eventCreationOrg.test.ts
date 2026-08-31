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

  it("shows the org note when there is a choice", () => {
    expect(
      eventCreationOrgMode([
        { id: "o1", name: "Northbridge" },
        { id: "o2", name: "Harbor" },
      ]),
    ).toEqual({ kind: "picker", note: EVENT_ORG_LOCKED_NOTE });
  });

  /**
   * ORG-2 replaced W-6's flat "an event can't move to a different organization
   * later" with what is actually true: a draft can move, a published event
   * cannot. The old line overstated the stakes of a choice the organizer was
   * making in the first thirty seconds of using the product.
   */
  it("promises only what ORG-2 delivers — a draft can move, a published event stays", () => {
    expect(EVENT_ORG_LOCKED_NOTE).toMatch(/draft/i);
    expect(EVENT_ORG_LOCKED_NOTE).toMatch(/published/i);
    expect(EVENT_ORG_LOCKED_NOTE).not.toMatch(/can't move to a different organization later/);
  });

  it("the wizard uses the quiet line for one org and the note for many", () => {
    const page = readFileSync(join(__dirname, "..", "pages", "organizer", "events", "new.tsx"), "utf8");
    expect(page).toContain("Creating in {orgs[0]!.name}");
    expect(page).toContain("EVENT_ORG_LOCKED_NOTE");
    expect(page).toContain("if (orgs.length === 1)");
  });
});
