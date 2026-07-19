/**
 * Certificate PDF rendering (pdfkit) + merge fields.
 */

import PDFDocument from "pdfkit";
import { brand } from "@event-app/config";
import { applyCertificateMergeFields, type CertificateMergeValues } from "./merge";

export type CertificatePdfInput = {
  titleText: string;
  bodyText?: string | null;
  signatureImageUrl?: string | null;
  merge: CertificateMergeValues;
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

export async function renderCertificatePdf(input: CertificatePdfInput): Promise<Buffer> {
  const title = applyCertificateMergeFields(input.titleText, input.merge);
  const body = input.bodyText
    ? applyCertificateMergeFields(input.bodyText, {
        ...input.merge,
        signatureImage: input.merge.signatureImage ?? input.signatureImageUrl ?? "",
      })
    : "";

  const doc = new PDFDocument({ size: "LETTER", margin: 54 });
  const done = collectPdf(doc);

  doc
    .fillColor(brand.colors.primary)
    .rect(0, 0, doc.page.width, 18)
    .fill();

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
