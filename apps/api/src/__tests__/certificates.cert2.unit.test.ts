/**
 * CERT-2 — image-background certificates.
 *
 * Three things are worth pinning here. The renderer must survive every shape of
 * IMAGE_BACKGROUND input without throwing, because one bad template must never
 * take down a batch of hundreds. The placement math must be proportional, since
 * the organizer's live preview calls the same helper with CSS pixels and would
 * otherwise lie about where the name lands. And the TEXT path must be
 * untouched — proven by rendering the pre-CERT-2 input and the explicitly-TEXT
 * input and comparing the bytes.
 */

import { describe, expect, it } from "vitest";
import {
  CERTIFICATE_NAME_BOX_DEFAULT,
  CERTIFICATE_NAME_COLORS,
  CERTIFICATE_NAME_FONT_SIZE_MAX,
  CERTIFICATE_NAME_FONT_SIZE_MIN,
  CERTIFICATE_NAME_SIDE_INSET,
  CERTIFICATE_NAME_Y_PCT_MAX,
  CERTIFICATE_NAME_Y_PCT_MIN,
  CERTIFICATE_PAGE_POINTS,
  certificateNamePlacement,
  certificatePageAspectRatio,
  certificatePageSize,
  normalizeCertificateNameBox,
} from "@event-app/shared";
import { renderCertificatePdf } from "../lib/certificates/pdf";
import {
  CERTIFICATE_DESIGN_DEFAULTS,
  resolveCertificateDesign,
  validateCertificateBackground,
} from "../lib/certificates/design";
import { HttpError } from "../lib/authorization";

/** 1x1 PNG — real magic bytes, so the renderer takes the image branch. */
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** 1x1 JPEG. */
const TINY_JPEG =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDs0NDT/wAALCAABAAEBAREA/8QAFAABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AmgA//9k=";

const MERGE = {
  attendeeName: "Priya Raghunathan",
  eventName: "DocWeek 2026",
  dates: "July 1 – July 3, 2026",
  hours: 12.5,
  certificateId: "cert_public_id",
};

function isPdf(buf: Buffer): boolean {
  return Buffer.isBuffer(buf) && buf.subarray(0, 4).toString("utf8") === "%PDF" && buf.length > 200;
}

/**
 * pdfkit stamps a wall-clock CreationDate and a derived /ID into every file, so
 * two renders of identical input differ in exactly those bytes. Blanking them
 * is what makes a byte-for-byte comparison meaningful rather than flaky.
 */
function stripNondeterministic(buf: Buffer): string {
  return buf
    .toString("latin1")
    .replace(/\/CreationDate \([^)]*\)/g, "/CreationDate ()")
    .replace(/\/ModDate \([^)]*\)/g, "/ModDate ()")
    .replace(/\/ID \[[^\]]*\]/g, "/ID []");
}

describe("CERT-2 name placement math", () => {
  it("swaps the page axes for landscape and keeps LETTER for portrait", () => {
    expect(certificatePageSize("PORTRAIT")).toEqual({
      width: CERTIFICATE_PAGE_POINTS.width,
      height: CERTIFICATE_PAGE_POINTS.height,
    });
    expect(certificatePageSize("LANDSCAPE")).toEqual({
      width: CERTIFICATE_PAGE_POINTS.height,
      height: CERTIFICATE_PAGE_POINTS.width,
    });
    // An absent orientation is landscape, matching the column default.
    expect(certificatePageSize(null)).toEqual(certificatePageSize("LANDSCAPE"));
    expect(certificatePageAspectRatio("LANDSCAPE")).toBeLessThan(1);
    expect(certificatePageAspectRatio("PORTRAIT")).toBeGreaterThan(1);
  });

  it("insets the text box symmetrically and centres it on yPct", () => {
    const page = certificatePageSize("LANDSCAPE");
    const placement = certificateNamePlacement({
      orientation: "LANDSCAPE",
      nameBox: { yPct: 50, fontSize: 32, color: "#000000", align: "center" },
      surfaceWidth: page.width,
    });
    expect(placement.x).toBeCloseTo(page.width * CERTIFICATE_NAME_SIDE_INSET, 6);
    expect(placement.width).toBeCloseTo(page.width - placement.x * 2, 6);
    expect(placement.centerY).toBeCloseTo(page.height / 2, 6);
    // At page scale the stored point size is used verbatim.
    expect(placement.fontSize).toBeCloseTo(32, 6);
    expect(placement.surfaceHeight).toBeCloseTo(page.height, 6);
  });

  it("moves centreY proportionally with yPct", () => {
    const page = certificatePageSize("PORTRAIT");
    const at = (yPct: number) =>
      certificateNamePlacement({
        orientation: "PORTRAIT",
        nameBox: { yPct },
        surfaceWidth: page.width,
      }).centerY;
    expect(at(25)).toBeCloseTo(page.height * 0.25, 6);
    expect(at(75)).toBeCloseTo(page.height * 0.75, 6);
    expect(at(75) - at(25)).toBeCloseTo(page.height * 0.5, 6);
  });

  /**
   * The preview's honesty test: the same box rendered onto a 300px-wide preview
   * must be the page placement scaled by 300/pageWidth, or the organizer is
   * positioning the name against a picture that does not match the PDF.
   */
  it("scales every returned number so a preview matches the page", () => {
    const nameBox = { yPct: 62, fontSize: 40, color: "#FFFFFF", align: "center" as const };
    const page = certificatePageSize("LANDSCAPE");
    const atPage = certificateNamePlacement({
      orientation: "LANDSCAPE",
      nameBox,
      surfaceWidth: page.width,
    });
    const previewWidth = 300;
    const atPreview = certificateNamePlacement({
      orientation: "LANDSCAPE",
      nameBox,
      surfaceWidth: previewWidth,
    });
    const scale = previewWidth / page.width;
    expect(atPreview.x).toBeCloseTo(atPage.x * scale, 6);
    expect(atPreview.width).toBeCloseTo(atPage.width * scale, 6);
    expect(atPreview.centerY).toBeCloseTo(atPage.centerY * scale, 6);
    expect(atPreview.fontSize).toBeCloseTo(atPage.fontSize * scale, 6);
    expect(atPreview.surfaceHeight).toBeCloseTo(atPage.surfaceHeight * scale, 6);
  });

  it("normalizes an empty, absent, or junk nameBox to the defaults", () => {
    // `{}` is what every row that predates CERT-2 carries.
    expect(normalizeCertificateNameBox({})).toEqual(CERTIFICATE_NAME_BOX_DEFAULT);
    expect(normalizeCertificateNameBox(null)).toEqual(CERTIFICATE_NAME_BOX_DEFAULT);
    expect(normalizeCertificateNameBox("nope")).toEqual(CERTIFICATE_NAME_BOX_DEFAULT);
    expect(normalizeCertificateNameBox([1, 2])).toEqual(CERTIFICATE_NAME_BOX_DEFAULT);
    expect(normalizeCertificateNameBox({ yPct: Number.NaN, fontSize: Infinity })).toEqual(
      CERTIFICATE_NAME_BOX_DEFAULT,
    );
  });

  it("clamps out-of-range values instead of drawing off the page", () => {
    expect(normalizeCertificateNameBox({ yPct: -40 }).yPct).toBe(CERTIFICATE_NAME_Y_PCT_MIN);
    expect(normalizeCertificateNameBox({ yPct: 400 }).yPct).toBe(CERTIFICATE_NAME_Y_PCT_MAX);
    expect(normalizeCertificateNameBox({ fontSize: 1 }).fontSize).toBe(
      CERTIFICATE_NAME_FONT_SIZE_MIN,
    );
    expect(normalizeCertificateNameBox({ fontSize: 9000 }).fontSize).toBe(
      CERTIFICATE_NAME_FONT_SIZE_MAX,
    );
  });

  it("accepts hex colours and rejects anything else", () => {
    expect(normalizeCertificateNameBox({ color: "#fff" }).color).toBe("#FFF");
    expect(normalizeCertificateNameBox({ color: " #1f2933 " }).color).toBe("#1F2933");
    expect(normalizeCertificateNameBox({ color: "periwinkle" }).color).toBe(
      CERTIFICATE_NAME_BOX_DEFAULT.color,
    );
    expect(normalizeCertificateNameBox({ color: "javascript:alert(1)" }).color).toBe(
      CERTIFICATE_NAME_BOX_DEFAULT.color,
    );
  });

  it("keeps a known align and falls back on an unknown one", () => {
    expect(normalizeCertificateNameBox({ align: "left" }).align).toBe("left");
    expect(normalizeCertificateNameBox({ align: "right" }).align).toBe("right");
    expect(normalizeCertificateNameBox({ align: "diagonal" }).align).toBe("center");
  });

  it("never returns NaN for a zero or nonsense surface width", () => {
    for (const surfaceWidth of [0, -100, Number.NaN]) {
      const placement = certificateNamePlacement({
        orientation: "LANDSCAPE",
        nameBox: {},
        surfaceWidth,
      });
      for (const value of [placement.x, placement.width, placement.centerY, placement.fontSize]) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
});

describe("CERT-2 renderer branches", () => {
  it("renders an IMAGE_BACKGROUND certificate in both orientations", async () => {
    for (const orientation of ["LANDSCAPE", "PORTRAIT"] as const) {
      const pdf = await renderCertificatePdf({
        titleText: "Certificate of Attendance",
        merge: MERGE,
        kind: "IMAGE_BACKGROUND",
        backgroundImageUrl: TINY_PNG,
        nameBox: { yPct: 62, fontSize: 36, color: "#FFFFFF", align: "center" },
        orientation,
      });
      expect(isPdf(pdf)).toBe(true);
    }
  });

  it("renders with orientation omitted (landscape default)", async () => {
    const pdf = await renderCertificatePdf({
      titleText: "Certificate of Attendance",
      merge: MERGE,
      kind: "IMAGE_BACKGROUND",
      backgroundImageUrl: TINY_PNG,
      nameBox: {},
    });
    expect(isPdf(pdf)).toBe(true);
  });

  it("accepts a JPEG design as well as a PNG", async () => {
    const pdf = await renderCertificatePdf({
      titleText: "Certificate",
      merge: MERGE,
      kind: "IMAGE_BACKGROUND",
      backgroundImageUrl: TINY_JPEG,
      orientation: "LANDSCAPE",
    });
    expect(isPdf(pdf)).toBe(true);
  });

  it("does not throw on any unusable background, and keeps issuing a PDF", async () => {
    const unusable = [
      null,
      undefined,
      "",
      "   ",
      "https://example.invalid/design.png",
      "data:image/png;base64,not-valid!!!",
      // A real data URL whose bytes are not a PNG/JPEG at all.
      `data:image/png;base64,${Buffer.from("<svg/>").toString("base64")}`,
      "data:application/pdf;base64,JVBERi0=",
    ];
    for (const backgroundImageUrl of unusable) {
      const pdf = await renderCertificatePdf({
        titleText: "Certificate of Attendance",
        bodyText: "Awarded to {attendeeName}.",
        merge: MERGE,
        kind: "IMAGE_BACKGROUND",
        backgroundImageUrl,
        orientation: "PORTRAIT",
      });
      expect(isPdf(pdf)).toBe(true);
    }
  });

  it("falls back to the built-in layout when the design is unusable", async () => {
    // Byte-identical to the TEXT render proves the fallback is the real layout,
    // not a blank page that merely happens to be a valid PDF.
    const base = {
      titleText: "Certificate of Attendance",
      bodyText: "Awarded to {attendeeName} for {eventName}.",
      merge: MERGE,
      accentColor: "#0f766e",
    };
    const fallback = await renderCertificatePdf({
      ...base,
      kind: "IMAGE_BACKGROUND",
      backgroundImageUrl: "https://example.invalid/design.png",
      orientation: "PORTRAIT",
    });
    const builtIn = await renderCertificatePdf({ ...base, kind: "TEXT" });
    expect(stripNondeterministic(fallback)).toBe(stripNondeterministic(builtIn));
  });

  it("renders an image background with no attendee name without throwing", async () => {
    const pdf = await renderCertificatePdf({
      titleText: "Certificate",
      merge: { ...MERGE, attendeeName: "   " },
      kind: "IMAGE_BACKGROUND",
      backgroundImageUrl: TINY_PNG,
    });
    expect(isPdf(pdf)).toBe(true);
  });

  it("tolerates a junk nameBox on the image branch", async () => {
    for (const nameBox of [null, undefined, "nope", 42, { yPct: "high" }]) {
      const pdf = await renderCertificatePdf({
        titleText: "Certificate",
        merge: MERGE,
        kind: "IMAGE_BACKGROUND",
        backgroundImageUrl: TINY_PNG,
        nameBox,
      });
      expect(isPdf(pdf)).toBe(true);
    }
  });
});

describe("CERT-2 leaves the TEXT layout alone", () => {
  /**
   * The regression that matters most: every template that exists today becomes
   * kind = TEXT, and its certificate must come out exactly as it did before.
   */
  it("renders pre-CERT-2 input byte-for-byte identically to kind TEXT", async () => {
    const base = {
      titleText: "Certificate of completion",
      bodyText: "Awarded to {attendeeName} for {eventName} ({dates}). Hours: {hours}.",
      signatureImageUrl: TINY_PNG,
      merge: MERGE,
      accentColor: "#0f766e",
      logoUrl: TINY_PNG,
    };
    // No kind at all — the shape every caller used before this chunk.
    const legacy = await renderCertificatePdf(base);
    const explicit = await renderCertificatePdf({ ...base, kind: "TEXT" });
    expect(stripNondeterministic(legacy)).toBe(stripNondeterministic(explicit));
  });

  it("ignores design fields entirely when kind is TEXT", async () => {
    const base = {
      titleText: "Certificate of completion",
      bodyText: "Awarded to {attendeeName}.",
      merge: MERGE,
    };
    const plain = await renderCertificatePdf({ ...base, kind: "TEXT" });
    const withIgnoredDesign = await renderCertificatePdf({
      ...base,
      kind: "TEXT",
      backgroundImageUrl: TINY_PNG,
      nameBox: { yPct: 90, fontSize: 70, color: "#FFFFFF", align: "right" },
      orientation: "PORTRAIT",
    });
    expect(stripNondeterministic(plain)).toBe(stripNondeterministic(withIgnoredDesign));
  });
});

describe("CERT-2 background validation", () => {
  it("accepts PNG and JPEG data URLs", () => {
    expect(validateCertificateBackground(TINY_PNG)).toBe(TINY_PNG);
    expect(validateCertificateBackground(` ${TINY_JPEG} `)).toBe(TINY_JPEG);
  });

  it("refuses a remote URL rather than silently ignoring it", () => {
    // Accepting it would render the built-in layout and leave the organizer
    // wondering where their design went.
    expect(() => validateCertificateBackground("https://example.com/design.png")).toThrow(HttpError);
  });

  it("refuses formats the renderer cannot embed", () => {
    for (const url of [
      "data:image/gif;base64,R0lGODdh",
      "data:image/svg+xml;base64,PHN2Zy8+",
      "data:application/pdf;base64,JVBERi0=",
      "not a url at all",
    ]) {
      expect(() => validateCertificateBackground(url)).toThrow(HttpError);
    }
  });

  it("refuses an upload past the byte ceiling", () => {
    const huge = `data:image/png;base64,${"A".repeat(20_000_000)}`;
    expect(() => validateCertificateBackground(huge)).toThrow(HttpError);
  });
});

describe("CERT-2 template design fields (patchFields semantics)", () => {
  const stored = {
    kind: "IMAGE_BACKGROUND" as const,
    backgroundImageUrl: TINY_PNG,
    nameBox: { yPct: 70, fontSize: 40, color: "#FFFFFF", align: "center" },
    orientation: "PORTRAIT" as const,
  };

  it("defaults to today's behaviour when a client sends none of the fields", () => {
    expect(resolveCertificateDesign({}, CERTIFICATE_DESIGN_DEFAULTS)).toEqual({
      kind: "TEXT",
      backgroundImageUrl: null,
      nameBox: CERTIFICATE_NAME_BOX_DEFAULT,
      orientation: "LANDSCAPE",
    });
  });

  it("leaves an omitted field untouched", () => {
    // The point of the contract: saving a slider nudge must not resend the art.
    const next = resolveCertificateDesign({ nameBox: { yPct: 30 } }, stored);
    expect(next.backgroundImageUrl).toBe(TINY_PNG);
    expect(next.kind).toBe("IMAGE_BACKGROUND");
    expect(next.orientation).toBe("PORTRAIT");
    expect(next.nameBox.yPct).toBe(30);
  });

  it("patches a partial nameBox field-by-field", () => {
    const next = resolveCertificateDesign({ nameBox: { fontSize: 24 } }, stored);
    expect(next.nameBox).toEqual({
      yPct: 70,
      fontSize: 24,
      color: "#FFFFFF",
      align: "center",
    });
  });

  it("treats an explicit null nameBox as a reset to defaults", () => {
    expect(resolveCertificateDesign({ nameBox: null, kind: "TEXT" }, stored).nameBox).toEqual(
      CERTIFICATE_NAME_BOX_DEFAULT,
    );
  });

  it("clears the artwork on explicit null or blank, and drops back to TEXT with it", () => {
    for (const backgroundImageUrl of [null, "", "   "]) {
      const next = resolveCertificateDesign({ backgroundImageUrl, kind: "TEXT" }, stored);
      expect(next.backgroundImageUrl).toBeNull();
      expect(next.kind).toBe("TEXT");
    }
  });

  it("refuses IMAGE_BACKGROUND with no artwork instead of saving a broken template", () => {
    expect(() => resolveCertificateDesign({ kind: "IMAGE_BACKGROUND" }, CERTIFICATE_DESIGN_DEFAULTS)).toThrow(
      HttpError,
    );
    // Including the case where the organizer removed the art but stayed on the kind.
    expect(() => resolveCertificateDesign({ backgroundImageUrl: null }, stored)).toThrow(HttpError);
  });

  it("normalizes a submitted nameBox rather than trusting it", () => {
    const next = resolveCertificateDesign(
      { nameBox: { yPct: 999, fontSize: 0, color: "chartreuse" } },
      stored,
    );
    expect(next.nameBox.yPct).toBe(CERTIFICATE_NAME_Y_PCT_MAX);
    expect(next.nameBox.fontSize).toBe(CERTIFICATE_NAME_FONT_SIZE_MIN);
    expect(next.nameBox.color).toBe(CERTIFICATE_NAME_BOX_DEFAULT.color);
  });

  it("switches a TEXT template to an uploaded design in one save", () => {
    const next = resolveCertificateDesign(
      {
        kind: "IMAGE_BACKGROUND",
        backgroundImageUrl: TINY_JPEG,
        orientation: "LANDSCAPE",
        nameBox: { yPct: 55, color: CERTIFICATE_NAME_COLORS.light },
      },
      CERTIFICATE_DESIGN_DEFAULTS,
    );
    expect(next).toEqual({
      kind: "IMAGE_BACKGROUND",
      backgroundImageUrl: TINY_JPEG,
      orientation: "LANDSCAPE",
      nameBox: {
        yPct: 55,
        fontSize: CERTIFICATE_NAME_BOX_DEFAULT.fontSize,
        color: CERTIFICATE_NAME_COLORS.light,
        align: "center",
      },
    });
  });
});
