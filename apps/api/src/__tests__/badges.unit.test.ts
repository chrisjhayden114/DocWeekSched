import { describe, expect, it } from "vitest";
import PDFDocument from "pdfkit";
import { BadgeSheetSize } from "@prisma/client";
import { autoshrinkFontSize, layoutFor, longestName, renderBadgePdf } from "../lib/badges";

describe("Phase P4 badge PDF helpers", () => {
  it("picks the longest real roster name for preview", () => {
    expect(longestName(["Ann", "Christopher Hayden", "Bo"])).toBe("Christopher Hayden");
    expect(longestName([])).toBe("");
  });

  it("defines Avery-compatible sheet layouts with margins", () => {
    const s34 = layoutFor(BadgeSheetSize.SIZE_3X4);
    expect(s34.cols * s34.rows).toBe(4);
    expect(s34.cellW).toBeCloseTo(3 * 72, 0);
    expect(s34.cellH).toBeCloseTo(4 * 72, 0);
    expect(s34.marginX).toBeGreaterThan(0);

    const s46 = layoutFor(BadgeSheetSize.SIZE_4X6);
    expect(s46.cols * s46.rows).toBe(1);
    expect(s46.cellW).toBeCloseTo(4 * 72, 0);

    const a6 = layoutFor(BadgeSheetSize.SIZE_A6);
    expect(a6.cols * a6.rows).toBe(4);
  });

  it("autoshrinks long names instead of truncating", () => {
    const doc = new PDFDocument({ size: "LETTER", margin: 0 });
    const long = "Alexandria Maximiliane-Constantinopoli";
    const size = autoshrinkFontSize(doc, long, 120, 22, 6);
    expect(size).toBeLessThan(22);
    expect(size).toBeGreaterThanOrEqual(6);
    doc.fontSize(size);
    expect(doc.widthOfString(long)).toBeLessThanOrEqual(120 + 0.5);
    doc.end();
  });

  it("renders a multi-badge PDF buffer", async () => {
    const pdf = await renderBadgePdf({
      template: {
        sheetSize: BadgeSheetSize.SIZE_3X4,
        showLogo: true,
        showName: true,
        showAffiliation: true,
        showRole: true,
        showQr: true,
        showBrandColorBar: true,
      },
      eventName: "Test Event",
      brandColor: "#0033A0",
      attendees: [
        {
          userId: "u1",
          name: "Ada Lovelace",
          affiliation: "Analytical Engines",
          role: "ATTENDEE",
          checkInCode: "checkincode123456",
        },
        {
          userId: "u2",
          name: "Grace Hopper",
          affiliation: "USN",
          role: "SPEAKER",
          checkInCode: "checkincode654321",
        },
      ],
    });
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 4).toString("utf8")).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
