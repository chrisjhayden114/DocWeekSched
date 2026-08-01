import { describe, expect, it } from "vitest";
import {
  isEmptyWizardDraft,
  parseWizardDraft,
  serializeWizardDraft,
  type WizardDraft,
} from "../lib/wizardDraft";

function draft(overrides: Partial<WizardDraft> = {}): WizardDraft {
  return {
    step: 1,
    organizationId: "org-1",
    name: "Coastal Ecology Symposium",
    slug: "coastal-ecology-symposium",
    slugTouched: false,
    description: "Two days of talks.",
    timezone: "America/Los_Angeles",
    startDate: "2026-09-10T09:00",
    endDate: "2026-09-11T17:00",
    venueName: "Marine Lab",
    venueAddress: "1 Shore Dr",
    onlineUrl: "",
    brandColor: "#0033A0",
    featureOverrides: { qa: "on" },
    ...overrides,
  };
}

describe("wizard draft round-trip", () => {
  it("restores every field it stored", () => {
    const original = draft();
    expect(parseWizardDraft(serializeWizardDraft(original))).toEqual(original);
  });

  it("preserves a manually edited slug and its touched flag", () => {
    const original = draft({ slug: "my-custom-slug", slugTouched: true });
    const restored = parseWizardDraft(serializeWizardDraft(original));
    expect(restored?.slug).toBe("my-custom-slug");
    expect(restored?.slugTouched).toBe(true);
  });

  it("never persists the created screen as a step", () => {
    const restored = parseWizardDraft(serializeWizardDraft(draft({ step: 4 })));
    expect(restored?.step).toBe(3);
  });
});

describe("parseWizardDraft resilience", () => {
  it("returns null for missing or malformed storage", () => {
    expect(parseWizardDraft(null)).toBeNull();
    expect(parseWizardDraft("")).toBeNull();
    expect(parseWizardDraft("not json {")).toBeNull();
    expect(parseWizardDraft('"a string"')).toBeNull();
    expect(parseWizardDraft("[1,2]")).toBeNull();
  });

  it("returns null for a draft with nothing typed, so restore is skipped", () => {
    const empty = draft({
      name: "",
      description: "",
      startDate: "",
      endDate: "",
      venueName: "",
      venueAddress: "",
      onlineUrl: "",
      featureOverrides: {},
    });
    expect(isEmptyWizardDraft(empty)).toBe(true);
    expect(parseWizardDraft(serializeWizardDraft(empty))).toBeNull();
  });

  it("coerces wrong-typed fields instead of crashing", () => {
    const raw = JSON.stringify({
      step: "2",
      name: "Kept",
      slugTouched: "yes",
      featureOverrides: [1, 2],
      startDate: 42,
    });
    const restored = parseWizardDraft(raw);
    expect(restored).not.toBeNull();
    expect(restored?.step).toBe(0);
    expect(restored?.name).toBe("Kept");
    expect(restored?.slugTouched).toBe(false);
    expect(restored?.featureOverrides).toEqual({});
    expect(restored?.startDate).toBe("");
  });
});
