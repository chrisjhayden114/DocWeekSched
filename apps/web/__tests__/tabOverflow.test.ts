import { describe, expect, it } from "vitest";
import { planTabOverflow } from "../lib/tabOverflow";

const IDS = ["overview", "program", "people", "invites", "maps", "announcements", "ops", "readiness", "recap", "features"] as const;
type Id = (typeof IDS)[number];

function widths(px: number): Record<Id, number> {
  return Object.fromEntries(IDS.map((id) => [id, px])) as Record<Id, number>;
}

describe("planTabOverflow", () => {
  it("keeps every tab visible when the row fits", () => {
    const plan = planTabOverflow({
      ids: IDS,
      widths: widths(80),
      available: 2000,
      moreWidth: 72,
      activeId: "overview",
      gap: 12,
    });
    expect(plan.visibleIds).toEqual([...IDS]);
    expect(plan.overflowIds).toEqual([]);
  });

  it("overflows trailing tabs once the More trigger has to be reserved", () => {
    // 10 × 80 + 9 × 12 = 908. Budget after More (72) + gap = 700 − 84 = 616
    // → 6 tabs (80×6 + 12×5 = 540) fit; Features and the three before it go.
    const plan = planTabOverflow({
      ids: IDS,
      widths: widths(80),
      available: 700,
      moreWidth: 72,
      activeId: "overview",
      gap: 12,
    });
    expect(plan.visibleIds).toEqual(["overview", "program", "people", "invites", "maps", "announcements"]);
    expect(plan.overflowIds).toEqual(["ops", "readiness", "recap", "features"]);
  });

  it("swaps the active overflow tab with the last visible so it stays on screen", () => {
    const plan = planTabOverflow({
      ids: IDS,
      widths: widths(80),
      available: 700,
      moreWidth: 72,
      activeId: "features",
      gap: 12,
    });
    expect(plan.visibleIds).toEqual(["overview", "program", "people", "invites", "maps", "features"]);
    expect(plan.overflowIds).toEqual(["announcements", "ops", "readiness", "recap"]);
    expect(plan.visibleIds).toContain("features");
    expect(plan.overflowIds).not.toContain("features");
  });

  it("shows every tab when measurement is not ready", () => {
    const unmeasured = planTabOverflow({
      ids: IDS,
      widths: {},
      available: 400,
      moreWidth: 72,
      activeId: "overview",
    });
    expect(unmeasured.visibleIds).toEqual([...IDS]);
    expect(unmeasured.overflowIds).toEqual([]);

    const zeroBox = planTabOverflow({
      ids: IDS,
      widths: widths(80),
      available: 0,
      moreWidth: 72,
      activeId: "overview",
    });
    expect(zeroBox.visibleIds).toEqual([...IDS]);
    expect(zeroBox.overflowIds).toEqual([]);
  });

  it("keeps at least the active tab when nothing else fits beside More", () => {
    const plan = planTabOverflow({
      ids: IDS,
      widths: widths(400),
      available: 200,
      moreWidth: 72,
      activeId: "recap",
      gap: 12,
    });
    expect(plan.visibleIds).toEqual(["recap"]);
    expect(plan.overflowIds).toEqual(IDS.filter((id) => id !== "recap"));
  });
});
