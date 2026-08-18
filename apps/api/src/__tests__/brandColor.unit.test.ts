import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BRAND_COLOR_MESSAGE, brandColorField, normalizeBrandColor } from "../lib/brandColor";
import { validationErrorBody } from "../lib/errors";

/**
 * BRAND-2 (2) — brandColor is validated and canonicalized server-side.
 * The accent derivation on the web falls back to neutral on unparsable input,
 * so an unvalidated store means "my color did nothing" with no explanation.
 */

describe("normalizeBrandColor — good input", () => {
  it("normalizes six-digit hex to lowercase #rrggbb", () => {
    expect(normalizeBrandColor("#0F766E")).toEqual({ ok: true, value: "#0f766e" });
  });

  it("expands three-digit shorthand", () => {
    expect(normalizeBrandColor("#0A7")).toEqual({ ok: true, value: "#00aa77" });
    expect(normalizeBrandColor("fff")).toEqual({ ok: true, value: "#ffffff" });
  });

  it("accepts a missing # and surrounding whitespace", () => {
    expect(normalizeBrandColor("  0033A0 ")).toEqual({ ok: true, value: "#0033a0" });
  });

  it("is idempotent — a normalized value survives a second save unchanged", () => {
    const once = normalizeBrandColor("#0F766E");
    expect(once.ok && normalizeBrandColor(once.value)).toEqual({ ok: true, value: "#0f766e" });
  });
});

describe("normalizeBrandColor — missing input means no color, not an error", () => {
  it("treats undefined, null, empty, and blank as null", () => {
    for (const input of [undefined, null, "", "   "]) {
      expect(normalizeBrandColor(input)).toEqual({ ok: true, value: null });
    }
  });
});

describe("normalizeBrandColor — bad input", () => {
  it("rejects non-hex, wrong-length, and CSS-color-ish values", () => {
    for (const input of [
      "blue",
      "#12",
      "#1234",
      "#12345",
      "#1234567",
      "#12345g",
      "rgb(0,0,0)",
      "0x0033a0",
      "#00 33 a0",
      "#0033a0;",
    ]) {
      expect(normalizeBrandColor(input), input).toEqual({ ok: false });
    }
  });
});

describe("brandColorField (zod)", () => {
  it("leaves an absent field undefined so a route can tell untouched from cleared", () => {
    const parsed = brandColorField.safeParse(undefined);
    expect(parsed.success && parsed.data).toBeUndefined();
  });

  it("passes an explicit null through as null (clear)", () => {
    const parsed = brandColorField.safeParse(null);
    expect(parsed.success && parsed.data).toBeNull();
  });

  it("normalizes on the way in", () => {
    const parsed = brandColorField.safeParse("#0A7");
    expect(parsed.success && parsed.data).toBe("#00aa77");
  });

  it("fails with the honest message naming the accepted shapes", () => {
    const parsed = brandColorField.safeParse("periwinkle");
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe(BRAND_COLOR_MESSAGE);
      expect(BRAND_COLOR_MESSAGE).toMatch(/hex/i);
    }
  });

  it("rejects an over-long value before it reaches the hex check", () => {
    expect(brandColorField.safeParse(`#${"a".repeat(64)}`).success).toBe(false);
  });
});

describe("inside an event payload", () => {
  // The shape the event routes use, so the 400 the client actually receives is
  // pinned — a message under the field name it belongs to, not a bare "Invalid
  // input" the organizer cannot act on.
  const payload = z.object({ name: z.string().min(1), brandColor: brandColorField });

  it("keys the rejection to brandColor in the standard error body", () => {
    const parsed = payload.safeParse({ name: "Coastal Ecology", brandColor: "cornflower" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const body = validationErrorBody(parsed.error);
      expect(body.details?.brandColor).toEqual([BRAND_COLOR_MESSAGE]);
    }
  });

  it("leaves the key out entirely when the client didn't send it", () => {
    const parsed = payload.safeParse({ name: "Coastal Ecology" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // What makes "absent = untouched" implementable in the route.
      expect("brandColor" in parsed.data).toBe(false);
      expect(parsed.data.brandColor).toBeUndefined();
    }
  });
});
