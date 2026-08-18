import { describe, expect, it } from "vitest";
import { z } from "zod";
import { patchFields, trimmedOrNull } from "../lib/patchFields";

/**
 * FIX-NULL — the absent-means-null bug class, pinned at the helper.
 *
 * Every assertion here is really about one of three sentences: an absent field
 * must not appear in the update at all (Prisma ignores undefined, but only if
 * the key is genuinely absent from the object we hand it), an explicit null or
 * an emptied text box must clear, and a real value must survive a round trip.
 */

describe("trimmedOrNull", () => {
  it("treats null, undefined, empty, and whitespace as no value", () => {
    for (const input of [null, undefined, "", "   ", "\n\t "]) {
      expect(trimmedOrNull(input)).toBeNull();
    }
  });

  it("trims a real value rather than storing the user's stray spaces", () => {
    expect(trimmedOrNull("  Hall A  ")).toBe("Hall A");
  });
});

describe("patchFields — absent means untouched", () => {
  it("returns no keys at all for an empty body", () => {
    expect(patchFields({}, ["description", "venueName"])).toEqual({});
  });

  it("omits the key rather than setting it to undefined", () => {
    // The distinction that matters: `{ location: undefined }` spread into a
    // Prisma update is harmless, but the same object compared or logged reads
    // as "location was part of this write". Keep it out.
    const patch = patchFields({ location: undefined }, ["location", "zoomLink"]);
    expect(Object.keys(patch)).toEqual([]);
    expect("location" in patch).toBe(false);
  });

  it("patches only the keys that were sent, leaving siblings out", () => {
    const patch = patchFields({ description: "Keynote", zoomLink: undefined }, [
      "description",
      "zoomLink",
      "fileUrl",
    ]);
    expect(patch).toEqual({ description: "Keynote" });
  });

  it("ignores keys the caller did not list, even when present in the body", () => {
    const body: Record<string, string | null | undefined> = {
      description: "Keynote",
      venueName: "Hall A",
    };
    expect(patchFields(body, ["description"])).toEqual({ description: "Keynote" });
  });
});

describe("patchFields — explicit null and empty mean clear", () => {
  it("clears on an explicit null", () => {
    expect(patchFields({ logoUrl: null }, ["logoUrl"])).toEqual({ logoUrl: null });
  });

  it("clears on an emptied or blanked text field", () => {
    expect(patchFields({ venueName: "", onlineUrl: "   " }, ["venueName", "onlineUrl"])).toEqual({
      venueName: null,
      onlineUrl: null,
    });
  });

  it("clears one field while patching another and leaving a third alone", () => {
    const patch = patchFields({ fileUrl: null, location: " Hall B " }, [
      "fileUrl",
      "location",
      "recordingUrl",
    ]);
    expect(patch).toEqual({ fileUrl: null, location: "Hall B" });
  });
});

describe("patchFields — behind a zod schema, as the routes use it", () => {
  // The routes never call patchFields on a raw body: zod drops absent
  // `.optional()` keys first, and that is what makes absent legible. This is
  // the seam, so it gets a test of its own.
  const schema = z.object({
    title: z.string().min(1),
    location: z.string().max(500).nullable().optional(),
    zoomLink: z.string().max(2000).nullable().optional(),
  });

  const clearable = ["location", "zoomLink"] as const;

  it("a title-only save patches nothing else", () => {
    const parsed = schema.parse({ title: "Renamed" });
    expect(patchFields(parsed, clearable)).toEqual({});
  });

  it("a JSON body cannot smuggle undefined past the schema as a clear", () => {
    // JSON has no undefined, so a caller that means "clear" must send null —
    // and a caller that means "leave alone" simply omits the key. Both shapes
    // survive the schema intact.
    const omitted = schema.parse(JSON.parse('{"title":"T"}'));
    const nulled = schema.parse(JSON.parse('{"title":"T","location":null}'));
    expect(patchFields(omitted, clearable)).toEqual({});
    expect(patchFields(nulled, clearable)).toEqual({ location: null });
  });

  it("round-trips a value the client did send", () => {
    const parsed = schema.parse({ title: "T", location: "Hall A", zoomLink: null });
    expect(patchFields(parsed, clearable)).toEqual({ location: "Hall A", zoomLink: null });
  });
});
