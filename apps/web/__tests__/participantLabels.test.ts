import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LEGACY_PARTICIPANT_TYPE_VALUES,
  participantLabelSelectOptions,
  shouldShowParticipantLabelSelect,
} from "../lib/participantLabels";

const webDir = join(__dirname, "..");
const dashboardSrc = readFileSync(join(webDir, "pages", "dashboard.tsx"), "utf8");
const welcomeSrc = readFileSync(join(webDir, "components", "WelcomeFlow.tsx"), "utf8");

describe("participantLabelSelectOptions — event labels, not the legacy enum", () => {
  it("builds options from the event list plus an optional empty choice", () => {
    expect(participantLabelSelectOptions(["Class of 2028", "Science Dept"])).toEqual([
      { value: "", label: "Choose one (optional)" },
      { value: "Class of 2028", label: "Class of 2028" },
      { value: "Science Dept", label: "Science Dept" },
    ]);
  });

  it("never injects the old hardcoded participantType values", () => {
    const options = participantLabelSelectOptions(["Faculty", "Student"]);
    const values = options.map((o) => o.value);
    for (const legacy of LEGACY_PARTICIPANT_TYPE_VALUES) {
      expect(values).not.toContain(legacy);
    }
  });

  it("hides the select when the event defines no labels", () => {
    expect(shouldShowParticipantLabelSelect([])).toBe(false);
    expect(shouldShowParticipantLabelSelect(undefined)).toBe(false);
    expect(shouldShowParticipantLabelSelect(["Class of 2028"])).toBe(true);
  });
});

describe("profile editor renders event labels not the legacy enum", () => {
  it("dashboard profile no longer hardcodes the old participantType options", () => {
    for (const legacy of LEGACY_PARTICIPANT_TYPE_VALUES) {
      expect(dashboardSrc).not.toContain(legacy);
    }
    expect(dashboardSrc).not.toContain("participantTypeLabel");
    expect(dashboardSrc).not.toContain("Grad Student");
    expect(dashboardSrc).not.toContain("EdD Student");
  });

  it("profile editor binds the select to event labels and membership.participantLabel", () => {
    expect(dashboardSrc).toContain("participantLabelSelectOptions(participantLabels)");
    expect(dashboardSrc).toContain("shouldShowParticipantLabelSelect(participantLabels)");
    expect(dashboardSrc).toContain('name="participantLabel"');
    expect(dashboardSrc).toContain('"/attendees/me"');
  });

  it("directory chips render participantLabel, not participantType", () => {
    expect(dashboardSrc).toContain("a.participantLabel");
    expect(dashboardSrc).not.toContain("a.participantType");
  });
});

describe("welcome flow offers the event label when defined", () => {
  it("shows the optional pick from event labels", () => {
    expect(welcomeSrc).toContain("shouldShowParticipantLabelSelect(participantLabels)");
    expect(welcomeSrc).toContain("participantLabelSelectOptions(participantLabels)");
  });
});
