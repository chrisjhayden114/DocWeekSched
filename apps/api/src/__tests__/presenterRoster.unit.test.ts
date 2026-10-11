/**
 * PRESENTER-ROSTER-1 — closed vocabulary. The column is a plain String, so
 * a typo or a hand-edited row can hold anything. Unknown values must never
 * hand out names.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRESENTER_ROSTER_VISIBILITY,
  PRESENTER_ROSTER_VISIBILITIES,
  PRESENTER_ROSTER_VISIBILITY_HELP,
  PRESENTER_ROSTER_VISIBILITY_LABELS,
  PRESENTER_ROSTER_VISIBILITY_SETTING_HELP,
  PRESENTER_ROSTER_VISIBILITY_SETTING_TITLE,
  asPresenterRosterVisibility,
  presenterRosterVisibilityOrDefault,
  presenterRosterVisibilitySelectOptions,
} from "@event-app/shared";

describe("presenterRosterVisibility vocabulary", () => {
  it("is three values, and COUNTS is the default", () => {
    expect([...PRESENTER_ROSTER_VISIBILITIES]).toEqual(["OFF", "COUNTS", "NAMES"]);
    expect(DEFAULT_PRESENTER_ROSTER_VISIBILITY).toBe("COUNTS");
  });

  it("fails CLOSED on anything it does not recognise — never NAMES", () => {
    for (const bad of ["names", "Names", "EVERYONE", "ATTENDEES", "", null, undefined, 7, {}]) {
      expect(asPresenterRosterVisibility(bad)).toBeNull();
      expect(presenterRosterVisibilityOrDefault(bad)).toBe("COUNTS");
    }
    expect(asPresenterRosterVisibility("NAMES")).toBe("NAMES");
    expect(asPresenterRosterVisibility("OFF")).toBe("OFF");
  });

  it("labels say what the presenter sees, not the internal tokens", () => {
    expect(presenterRosterVisibilitySelectOptions().map((o) => o.value)).toEqual([
      "OFF",
      "COUNTS",
      "NAMES",
    ]);
    for (const value of PRESENTER_ROSTER_VISIBILITIES) {
      expect(PRESENTER_ROSTER_VISIBILITY_LABELS[value]).not.toMatch(/\b(OFF|COUNTS|NAMES)\b/);
      expect(PRESENTER_ROSTER_VISIBILITY_HELP[value].length).toBeGreaterThan(20);
    }
    expect(PRESENTER_ROSTER_VISIBILITY_SETTING_TITLE).toBe(
      "What presenters can see about their sessions",
    );
    expect(PRESENTER_ROSTER_VISIBILITY_SETTING_HELP).toContain(
      "Presenters open this from their personal link",
    );
    expect(PRESENTER_ROSTER_VISIBILITY_SETTING_HELP).toContain(
      "visible in the attendee directory",
    );
  });
});
