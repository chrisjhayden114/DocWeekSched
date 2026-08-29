/**
 * Certificate PDF rendering (pdfkit) + merge fields.
 * BRAND-3: event accent colors the rule/bar; optional logo sits above the title.
 * Missing or unusable accent/logo falls back to the platform layout.
 */

import PDFDocument from "pdfkit";
import { brand } from "@event-app/config";
import { normalizeBrandColor } from "../brandColor";
import { applyCertificateMergeFields, type CertificateMergeValues } from "./merge";

export type CertificatePdfInput = {
  titleText: string;
  bodyText?: string | null;
  signatureImageUrl?: string | null;
  merge: CertificateMergeValues;
  /** Event brandColor — invalid/empty uses platform primary. */
  accentColor?: string | null;
  /** Event logo (data URL). Unreadable values are skipped. */
  logoUrl?: string | null;
};

function collectPdf(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

function tryParseDataUrlImage(url: string): Buffer | null {
  const m = /^data:image\/[a-zA-Z0-9+.-]+;base64,(.+)$/i.exec(url.trim());
  if (!m) return null;
  try {
    return Buffer.from(m[1]!, "base64");
  } catch {
    return null;
  }
}

function resolveAccent(raw?: string | null): string {
  const parsed = normalizeBrandColor(raw);
  return parsed.ok && parsed.value ? parsed.value : brand.colors.primary;
}

/** Draw a centered image; return false (and leave the cursor) if it cannot render. */
function embedCenteredImage(
  doc: PDFKit.PDFDocument,
  url: string | null | undefined,
  maxW: number,
  maxH: number,
): boolean {
  if (!url) return false;
  const buf = tryParseDataUrlImage(url);
  if (!buf) return false;
  try {
    const x = (doc.page.width - maxW) / 2;
    const y = doc.y;
    doc.image(buf, x, y, { fit: [maxW, maxH] });
    doc.y = y + maxH + 10;
    return true;
  } catch {
    return false;
  }
}

export async function renderCertificatePdf(input: CertificatePdfInput): Promise<Buffer> {
  const title = applyCertificateMergeFields(input.titleText, input.merge);
  const body = input.bodyText
    ? applyCertificateMergeFields(input.bodyText, {
        ...input.merge,
        signatureImage: input.merge.signatureImage ?? input.signatureImageUrl ?? "",
      })
    : "";

  const accent = resolveAccent(input.accentColor);
  const doc = new PDFDocument({ size: "LETTER", margin: 54 });
  const done = collectPdf(doc);

  doc.fillColor(accent).rect(0, 0, doc.page.width, 18).fill();

  // Logo sits just below the accent bar; skip entirely when unset or unreadable
  // so the title stays at the same cursor as the unbranded layout.
  if (input.logoUrl) {
    const maxW = 140;
    const maxH = 48;
    const y = 28;
    doc.y = y;
    if (!embedCenteredImage(doc, input.logoUrl, maxW, maxH)) {
      doc.y = doc.page.margins.top;
    }
  }

  doc
    .fillColor(brand.colors.ink)
    .font("Helvetica-Bold")
    .fontSize(28)
    .text(title, { align: "center" });
  doc.moveDown(1.5);

  if (body) {
    doc.font("Helvetica").fontSize(14).fillColor(brand.colors.ink).text(body, {
      align: "center",
      lineGap: 6,
    });
  }

  doc.moveDown(2);
  doc
    .font("Helvetica")
    .fontSize(11)
    .fillColor("#555555")
    .text(input.merge.attendeeName, { align: "center" });
  doc.text(input.merge.eventName, { align: "center" });
  doc.text(input.merge.dates, { align: "center" });
  if (input.merge.hours != null && String(input.merge.hours) !== "") {
    doc.text(`${input.merge.hours} hours`, { align: "center" });
  }

  const sigUrl = input.signatureImageUrl || input.merge.signatureImage;
  if (sigUrl) {
    const buf = tryParseDataUrlImage(sigUrl);
    if (buf) {
      doc.moveDown(1.5);
      const w = 160;
      doc.image(buf, (doc.page.width - w) / 2, doc.y, { width: w });
    }
  }

  doc.moveDown(2);
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#888888")
    .text(`Certificate ID: ${input.merge.certificateId}`, { align: "center" });

  doc.end();
  return done;
}
