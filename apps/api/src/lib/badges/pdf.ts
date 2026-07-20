/**
 * Avery-compatible badge PDF sheets (pdfkit).
 * Cell sizes: 3×4 in, 4×6 in, A6. Margins + crop marks. Autoshrink names — never truncate.
 */

import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { BadgeSheetSize, type BadgeTemplate, type EventMemberRole } from "@prisma/client";
import { brand } from "@event-app/config";

/** PDF points (1 in = 72 pt). */
const PT = 72;

export type BadgeAttendee = {
  userId: string;
  name: string;
  affiliation?: string | null;
  role?: EventMemberRole | string | null;
  checkInCode: string;
};

export type BadgeRenderOptions = {
  template: Pick<
    BadgeTemplate,
    | "sheetSize"
    | "showLogo"
    | "showName"
    | "showAffiliation"
    | "showRole"
    | "showQr"
    | "showBrandColorBar"
  >;
  eventName: string;
  brandColor?: string | null;
  logoUrl?: string | null;
  attendees: BadgeAttendee[];
};

type SheetLayout = {
  pageWidth: number;
  pageHeight: number;
  cellW: number;
  cellH: number;
  cols: number;
  rows: number;
  marginX: number;
  marginY: number;
  gutterX: number;
  gutterY: number;
};

function layoutFor(size: BadgeSheetSize): SheetLayout {
  switch (size) {
    case BadgeSheetSize.SIZE_4X6:
      // US Letter — one 4×6 badge centered
      return {
        pageWidth: 8.5 * PT,
        pageHeight: 11 * PT,
        cellW: 4 * PT,
        cellH: 6 * PT,
        cols: 1,
        rows: 1,
        marginX: (8.5 * PT - 4 * PT) / 2,
        marginY: (11 * PT - 6 * PT) / 2,
        gutterX: 0,
        gutterY: 0,
      };
    case BadgeSheetSize.SIZE_A6:
      // A4 — 2×2 A6 cells (105×148 mm)
      return {
        pageWidth: 595.28,
        pageHeight: 841.89,
        cellW: 105 * (PT / 25.4),
        cellH: 148 * (PT / 25.4),
        cols: 2,
        rows: 2,
        marginX: (595.28 - 2 * 105 * (PT / 25.4)) / 2,
        marginY: (841.89 - 2 * 148 * (PT / 25.4)) / 2,
        gutterX: 0,
        gutterY: 0,
      };
    case BadgeSheetSize.SIZE_3X4:
    default:
      // US Letter — 2×2 of 3×4 in (Avery-compatible registration)
      return {
        pageWidth: 8.5 * PT,
        pageHeight: 11 * PT,
        cellW: 3 * PT,
        cellH: 4 * PT,
        cols: 2,
        rows: 2,
        marginX: (8.5 * PT - 2 * 3 * PT) / 2,
        marginY: (11 * PT - 2 * 4 * PT) / 2,
        gutterX: 0,
        gutterY: 0,
      };
  }
}

function drawCropMarks(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  len = 8,
): void {
  doc.save();
  doc.strokeColor("#000000").lineWidth(0.4);
  const marks: Array<[number, number, number, number]> = [
    [x, y, x - len, y],
    [x, y, x, y - len],
    [x + w, y, x + w + len, y],
    [x + w, y, x + w, y - len],
    [x, y + h, x - len, y + h],
    [x, y + h, x, y + h + len],
    [x + w, y + h, x + w + len, y + h],
    [x + w, y + h, x + w, y + h + len],
  ];
  for (const [x1, y1, x2, y2] of marks) {
    doc.moveTo(x1, y1).lineTo(x2, y2).stroke();
  }
  doc.restore();
}

/** Shrink font until text width fits maxWidth — never truncate. */
export function autoshrinkFontSize(
  doc: PDFKit.PDFDocument,
  text: string,
  maxWidth: number,
  maxSize: number,
  minSize = 6,
): number {
  let size = maxSize;
  while (size > minSize) {
    doc.fontSize(size);
    if (doc.widthOfString(text) <= maxWidth) return size;
    size -= 0.5;
  }
  doc.fontSize(minSize);
  return minSize;
}

function resolveBrandColor(raw?: string | null): string {
  const c = raw?.trim();
  if (c && /^#[0-9A-Fa-f]{6}$/.test(c)) return c;
  return brand.colors.primary;
}

async function qrPng(payload: string): Promise<Buffer> {
  return QRCode.toBuffer(payload, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 256,
  });
}

function cellOrigin(layout: SheetLayout, indexOnPage: number): { x: number; y: number } {
  const col = indexOnPage % layout.cols;
  const row = Math.floor(indexOnPage / layout.cols);
  return {
    x: layout.marginX + col * (layout.cellW + layout.gutterX),
    y: layout.marginY + row * (layout.cellH + layout.gutterY),
  };
}

async function drawBadge(
  doc: PDFKit.PDFDocument,
  opts: BadgeRenderOptions,
  attendee: BadgeAttendee,
  x: number,
  y: number,
  layout: SheetLayout,
): Promise<void> {
  const { template } = opts;
  const pad = 10;
  const brandHex = resolveBrandColor(opts.brandColor);

  drawCropMarks(doc, x, y, layout.cellW, layout.cellH);

  if (template.showBrandColorBar) {
    doc.save();
    doc.rect(x, y, layout.cellW, 14).fill(brandHex);
    doc.restore();
  }

  let cursorY = y + (template.showBrandColorBar ? 22 : 12);

  if (template.showLogo && opts.eventName) {
    doc
      .fillColor(brand.colors.ink)
      .font("Helvetica")
      .fontSize(8)
      .text(opts.eventName, x + pad, cursorY, {
        width: layout.cellW - pad * 2,
        align: "center",
        lineBreak: false,
      });
    cursorY += 14;
  }

  if (template.showName) {
    const name = attendee.name || " ";
    const maxW = layout.cellW - pad * 2;
    const size = autoshrinkFontSize(doc, name, maxW, 22, 7);
    doc
      .fillColor(brand.colors.ink)
      .font("Helvetica-Bold")
      .fontSize(size)
      .text(name, x + pad, cursorY, { width: maxW, align: "center", lineBreak: false });
    cursorY += size + 8;
  }

  if (template.showAffiliation && attendee.affiliation) {
    const aff = attendee.affiliation;
    const maxW = layout.cellW - pad * 2;
    const size = autoshrinkFontSize(doc, aff, maxW, 11, 6);
    doc
      .fillColor("#444444")
      .font("Helvetica")
      .fontSize(size)
      .text(aff, x + pad, cursorY, { width: maxW, align: "center", lineBreak: false });
    cursorY += size + 6;
  }

  if (template.showRole && attendee.role) {
    doc
      .fillColor("#666666")
      .font("Helvetica")
      .fontSize(9)
      .text(String(attendee.role), x + pad, cursorY, {
        width: layout.cellW - pad * 2,
        align: "center",
        lineBreak: false,
      });
    cursorY += 14;
  }

  if (template.showQr && attendee.checkInCode) {
    const qrSize = Math.min(90, layout.cellW - pad * 2, layout.cellH - (cursorY - y) - 16);
    const buf = await qrPng(attendee.checkInCode);
    const qrX = x + (layout.cellW - qrSize) / 2;
    const qrY = y + layout.cellH - qrSize - 12;
    doc.image(buf, qrX, Math.max(qrY, cursorY), { width: qrSize, height: qrSize });
  }
}

function collectPdf(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

/** Longest roster name by character length (deterministic max for preview). */
export function longestName(names: string[]): string {
  let best = "";
  for (const n of names) {
    if (n.length > best.length) best = n;
  }
  return best;
}

export async function renderBadgePdf(opts: BadgeRenderOptions): Promise<Buffer> {
  const layout = layoutFor(opts.template.sheetSize);
  const perPage = layout.cols * layout.rows;
  const doc = new PDFDocument({
    size: [layout.pageWidth, layout.pageHeight],
    margin: 0,
    autoFirstPage: false,
  });
  const done = collectPdf(doc);

  const list = opts.attendees.length ? opts.attendees : [];
  if (!list.length) {
    doc.addPage({ size: [layout.pageWidth, layout.pageHeight], margin: 0 });
    doc.end();
    return done;
  }

  for (let i = 0; i < list.length; i++) {
    const onPage = i % perPage;
    if (onPage === 0) {
      doc.addPage({ size: [layout.pageWidth, layout.pageHeight], margin: 0 });
    }
    const { x, y } = cellOrigin(layout, onPage);
    await drawBadge(doc, opts, list[i]!, x, y, layout);
  }

  doc.end();
  return done;
}

export { layoutFor };
