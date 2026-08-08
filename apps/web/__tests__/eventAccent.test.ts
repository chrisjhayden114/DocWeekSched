import { describe, expect, it } from "vitest";
import {
  NEUTRAL_EVENT_ACCENT,
  accentFromBrand,
  contrastRatio,
  eventAccentStyle,
} from "../lib/eventAccent";

/**
 * Chunk F1.5.3 — contrast safety for the event-driven accent.
 *
 * The acceptance that matters most: a very light brand color must still yield
 * a readable filled control. Organizers pick arbitrary colors; the derived
 * accent — never the raw color — is what the UI renders, so these tests pin
 * the derivation, the neutral fallback, and the AA floor.
 */

const AA = 4.5;

describe("F1.5.3 — accentFromBrand contrast safety", () => {
  it("darkens a light brand color (#FFD400) until white text is readable", () => {
    const raw = "#FFD400";
    expect(contrastRatio(raw, "#ffffff")).toBeLessThan(AA); // the raw color really is unreadable
    const a = accentFromBrand(raw);
    expect(a.accent).not.toBe(raw.toLowerCase());
    expect(contrastRatio(a.accent, a.on)).toBeGreaterThanOrEqual(AA);
  });

  it("keeps a dark brand color as-is", () => {
    const a = accentFromBrand("#0033a0"); // already 4.5+ against white
    expect(a.accent).toBe("#0033a0");
    expect(a.on).toBe("#ffffff");
  });

  it("hover stays readable — both as text-on-white and under white text", () => {
    for (const brand of ["#FFD400", "#0033a0", "#e91e63", "#00ff00"]) {
      const a = accentFromBrand(brand);
      expect(contrastRatio(a.hover, "#ffffff")).toBeGreaterThanOrEqual(AA);
    }
  });

  it("tint is a light wash, usable behind dark text", () => {
    const a = accentFromBrand("#FFD400");
    // gray-900 body text must stay readable on the tint
    expect(contrastRatio(a.tint, "#161616")).toBeGreaterThanOrEqual(AA);
  });

  it("falls back to the restrained neutral when no brand color is set", () => {
    expect(accentFromBrand(null)).toEqual(NEUTRAL_EVENT_ACCENT);
    expect(accentFromBrand(undefined)).toEqual(NEUTRAL_EVENT_ACCENT);
    expect(accentFromBrand("")).toEqual(NEUTRAL_EVENT_ACCENT);
  });

  it("falls back to the neutral on unparsable input", () => {
    expect(accentFromBrand("not-a-color")).toEqual(NEUTRAL_EVENT_ACCENT);
    expect(accentFromBrand("#12")).toEqual(NEUTRAL_EVENT_ACCENT);
    expect(accentFromBrand("#12345g")).toEqual(NEUTRAL_EVENT_ACCENT);
  });

  it("the neutral default is not bright blue and is itself AA-readable", () => {
    expect(NEUTRAL_EVENT_ACCENT.accent).not.toBe("#0033a0");
    expect(contrastRatio(NEUTRAL_EVENT_ACCENT.accent, NEUTRAL_EVENT_ACCENT.on)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(NEUTRAL_EVENT_ACCENT.hover, "#ffffff")).toBeGreaterThanOrEqual(AA);
  });

  it("accepts 3-digit hex and a missing #", () => {
    expect(accentFromBrand("#03a")).not.toEqual(NEUTRAL_EVENT_ACCENT);
    expect(accentFromBrand("0033a0").accent).toBe("#0033a0");
  });
});

describe("F1.5.2 — eventAccentStyle runtime variables", () => {
  it("emits the four --event-accent custom properties", () => {
    const style = eventAccentStyle("#FFD400") as Record<string, string>;
    expect(Object.keys(style).sort()).toEqual([
      "--event-accent",
      "--event-accent-hover",
      "--event-accent-on",
      "--event-accent-tint",
    ]);
    expect(contrastRatio(style["--event-accent"], style["--event-accent-on"])).toBeGreaterThanOrEqual(AA);
  });
});
