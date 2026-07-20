import { describe, expect, it } from "vitest";
import {
  applyCertificateMergeFields,
  formatCertificateDates,
  formatHoursField,
} from "../lib/certificates/merge";

describe("Phase P4 certificate merge fields", () => {
  it("substitutes all six known fields", () => {
    const out = applyCertificateMergeFields(
      "This certifies that {attendeeName} completed {eventName} ({dates}). Hours: {hours}. Sig: {signatureImage}. ID: {certificateId}.",
      {
        attendeeName: "Ada Lovelace",
        eventName: "DocWeek 2026",
        dates: "July 1 - July 3, 2026",
        hours: 12.5,
        signatureImage: "https://example.com/sig.png",
        certificateId: "abc123_public",
      },
    );
    expect(out).toBe(
      "This certifies that Ada Lovelace completed DocWeek 2026 (July 1 - July 3, 2026). Hours: 12.5. Sig: https://example.com/sig.png. ID: abc123_public.",
    );
    expect(out.includes("{attendeeName}")).toBe(false);
    expect(out.includes("{hours}")).toBe(false);
  });

  it("renders missing hours as empty - never invents a value", () => {
    expect(formatHoursField(null)).toBe("");
    expect(formatHoursField(undefined)).toBe("");
    expect(
      applyCertificateMergeFields("Hours:{hours}.", {
        attendeeName: "A",
        eventName: "E",
        dates: "D",
        certificateId: "id",
      }),
    ).toBe("Hours:.");
    expect(
      applyCertificateMergeFields("Hours:{hours}.", {
        attendeeName: "A",
        eventName: "E",
        dates: "D",
        hours: null,
        certificateId: "id",
      }),
    ).toBe("Hours:.");
  });

  it("uses certificateId as the publicId value", () => {
    const publicId = "xY9_base64url_token";
    const out = applyCertificateMergeFields("Verify {certificateId}", {
      attendeeName: "A",
      eventName: "E",
      dates: "D",
      certificateId: publicId,
    });
    expect(out).toBe(`Verify ${publicId}`);
  });

  it("leaves unknown braces intact", () => {
    expect(
      applyCertificateMergeFields("Hello {unknownField}", {
        attendeeName: "A",
        eventName: "E",
        dates: "D",
        certificateId: "id",
      }),
    ).toBe("Hello {unknownField}");
  });

  it("formats date ranges without inventing hours", () => {
    const start = new Date("2026-07-01T12:00:00Z");
    const end = new Date("2026-07-03T12:00:00Z");
    const range = formatCertificateDates(start, end, "UTC");
    expect(range).toContain("2026");
    expect(range.includes("–") || range.includes("-")).toBe(true);
    expect(formatCertificateDates(start, start, "UTC")).not.toContain("–");
  });
});
