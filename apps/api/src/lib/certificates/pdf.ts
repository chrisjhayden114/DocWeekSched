/**
 * Certificate PDF rendering (pdfkit) + merge fields.
 * BRAND-3: event accent colors the rule/bar; optional logo sits above the title.
 * Missing or unusable accent/logo falls back to the platform layout.
 *
 * CERT-2: a template is one of two kinds and this module is where they part.
 * TEXT is the built-in layout below, untouched — the no-design-needed path.
 * IMAGE_BACKGROUND is the Canva-export reality: the organizer's finished PNG/JPG
 * IS the certificate, drawn full-bleed, and the ONLY thing we add is the
 * attendee's name. Everything upstream and downstream of here — eligibility,
 * batch issue, storage, the ready email, the public verify page — is shared by
 * both kinds and knows nothing about this branch.
 */

import PDFDocument from "pdfkit";
import { brand } from "@event-app/config";
import {
  certificateNamePlacement,
  type CertificateOrientation,
  type CertificateTemplateKind,
} from "@event-app/shared";
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
  /** CERT-2 — absent or TEXT renders the built-in layout. */
  kind?: CertificateTemplateKind | null;
  /** CERT-2 — the organizer's design as a data URL (PNG/JPG). */
  backgroundImageUrl?: string | null;
  /** CERT-2 — stored `{ yPct, fontSize, color, align }`; `{}` means defaults. */
  nameBox?: unknown;
  /** CERT-2 — page orientation for the IMAGE_BACKGROUND branch. */
  orientation?: CertificateOrientation | null;
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

/**
 * The organizer's upload, decoded, or null if we should not try to draw it.
 *
 * pdfkit can only embed PNG and JPEG, so the magic bytes are the honest gate
 * rather than the declared MIME type or the filename: a `.png` that is really a
 * PDF, an HEIC, or an SVG is caught here, before the page is even created, which
 * is what lets an unusable upload fall back to the built-in layout instead of
 * producing a broken page.
 */
function parseCertificateBackground(url: string | null | undefined): Buffer | null {
  if (!url) return null;
  const buf = tryParseDataUrlImage(url);
  if (!buf || buf.length < 4) return null;
  const isPng = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  return isPng || isJpeg ? buf : null;
}

/**
 * The organizer's design, full-bleed.
 *
 * `cover` scales the artwork to fill the page without distorting it, so a
 * design exported in a slightly different shape loses a little at the edges
 * rather than being squashed — the tradeoff the upload copy names out loud.
 */
function drawBackgroundImage(doc: PDFKit.PDFDocument, background: Buffer): void {
  doc.image(background, 0, 0, {
    cover: [doc.page.width, doc.page.height],
    align: "center",
    valign: "center",
  });
}

/**
 * The attendee's name — the only field CERT-2 overlays on an uploaded design.
 *
 * The box comes from the shared placement helper that the organizer's live
 * preview also calls, so what they positioned is what renders. Height is
 * measured rather than assumed so a name long enough to wrap stays centred on
 * the slider position instead of drifting below it.
 */
function drawOverlaidName(doc: PDFKit.PDFDocument, input: CertificatePdfInput): void {
  const name = input.merge.attendeeName?.trim();
  if (!name) return;

  const placement = certificateNamePlacement({
    orientation: input.orientation,
    nameBox: input.nameBox,
    surfaceWidth: doc.page.width,
  });

  doc.font("Helvetica-Bold").fontSize(placement.fontSize).fillColor(placement.color);

  const height = doc.heightOfString(name, { width: placement.width, align: placement.align });
  doc.text(name, placement.x, placement.centerY - height / 2, {
    width: placement.width,
    align: placement.align,
  });
}

/** The built-in layout (BRAND-3). Unchanged by CERT-2. */
function drawTextCertificate(doc: PDFKit.PDFDocument, input: CertificatePdfInput): void {
  const title = applyCertificateMergeFields(input.titleText, input.merge);
  const body = input.bodyText
    ? applyCertificateMergeFields(input.bodyText, {
        ...input.merge,
        signatureImage: input.merge.signatureImage ?? input.signatureImageUrl ?? "",
      })
    : "";

  const accent = resolveAccent(input.accentColor);

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
}

export async function renderCertificatePdf(input: CertificatePdfInput): Promise<Buffer> {
  // An IMAGE_BACKGROUND template whose upload is missing or not really a
  // PNG/JPEG renders the built-in layout instead. A batch of hundreds must not
  // turn into blank pages with a name floating on them, and a real certificate
  // in the wrong style beats a useless one — the same call BRAND-3 already
  // makes for an unreadable logo.
  const background =
    input.kind === "IMAGE_BACKGROUND" ? parseCertificateBackground(input.backgroundImageUrl) : null;

  if (!background) {
    const doc = new PDFDocument({ size: "LETTER", margin: 54 });
    const done = collectPdf(doc);
    drawTextCertificate(doc, input);
    doc.end();
    return done;
  }

  const doc = new PDFDocument({
    size: "LETTER",
    layout: input.orientation === "PORTRAIT" ? "portrait" : "landscape",
    margin: 0,
  });
  const done = collectPdf(doc);

  // Magic bytes said PNG/JPEG but pdfkit can still refuse a variant it does not
  // implement (16-bit or interlaced PNG). The page is already the artwork's
  // shape by then, so the name still goes down and the certificate stays
  // verifiable rather than the whole batch failing on one bad upload.
  try {
    drawBackgroundImage(doc, background);
  } catch {
    /* keep going — name-only on the chosen page size */
  }
  drawOverlaidName(doc, input);

  doc.end();
  return done;
}
