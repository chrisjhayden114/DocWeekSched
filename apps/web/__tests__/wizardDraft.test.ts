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
    brandColor: "#0f766e",
    logoUrl: "https://cdn.example.com/logo.png",
    bannerUrl: "",
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
      brandColor: "",
      logoUrl: "",
      bannerUrl: "",
      featureOverrides: {},
    });
    expect(isEmptyWizardDraft(empty)).toBe(true);
    expect(parseWizardDraft(serializeWizardDraft(empty))).toBeNull();
  });

  it("keeps a chosen brand color but does not invent one", () => {
    expect(parseWizardDraft(serializeWizardDraft(draft({ brandColor: "#0f766e" })))?.brandColor).toBe(
      "#0f766e",
    );
    // No color chosen stays no color — the wizard must not resurrect a default.
    expect(parseWizardDraft(serializeWizardDraft(draft({ brandColor: "" })))?.brandColor).toBe("");
  });

  it("persists typed image links but never multi-megabyte uploaded data URLs", () => {
    const uploaded = `data:image/jpeg;base64,${"A".repeat(500)}`;
    const restored = parseWizardDraft(
      serializeWizardDraft(draft({ logoUrl: "https://cdn.example.com/logo.png", bannerUrl: uploaded })),
    );
    expect(restored?.logoUrl).toBe("https://cdn.example.com/logo.png");
    // Dropped rather than risking a quota error that would lose the whole draft.
    expect(restored?.bannerUrl).toBe("");
  });

  it("a draft holding only an uploaded image counts as empty (nothing survives storage)", () => {
    const onlyUpload = draft({
      name: "",
      description: "",
      startDate: "",
      endDate: "",
      venueName: "",
      venueAddress: "",
      onlineUrl: "",
      brandColor: "",
      logoUrl: "data:image/jpeg;base64,AAAA",
      bannerUrl: "",
      featureOverrides: {},
    });
    expect(isEmptyWizardDraft(onlyUpload)).toBe(true);
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
