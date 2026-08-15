import { AGENDA_INGEST_MAX_BYTES } from "./constants";
import {
  DOCX_MIME,
  LEGACY_DOC_MIME,
  LEGACY_OFFICE_MESSAGE,
  LEGACY_XLS_MIME,
  OfficeParseError,
  XLSX_MIME,
  docxToText,
  xlsxToSheets,
} from "./office";
import { sheetsToSourceText } from "./spreadsheetText";

/** Strip tags / collapse whitespace for HTML sources. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function previewText(text: string, max = 2_000): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

/** Decode data-URL or treat plain text; binary non-utf8 yields a stub note. */
export function textFromDataUrl(dataUrl: string): string {
  const m = /^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/i.exec(dataUrl.trim());
  if (!m) return dataUrl;
  const mime = (m[1] || "text/plain").toLowerCase();
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > AGENDA_INGEST_MAX_BYTES) {
    throw new Error(`File exceeds max size of ${AGENDA_INGEST_MAX_BYTES} bytes`);
  }
  if (mime.startsWith("text/") || mime === "application/json" || mime.includes("csv")) {
    const text = buf.toString("utf8");
    return mime.includes("html") ? htmlToText(text) : text;
  }
  // Best-effort UTF-8 for office/pdf text fixtures stored as data URLs
  const asText = buf.toString("utf8");
  if (asText.includes("\u0000") || /[\x00-\x08\x0e-\x1f]/.test(asText.slice(0, 200))) {
    return `[Binary ${mime} upload, ${buf.length} bytes — extract from stored bytes / OCR stub]`;
  }
  return asText;
}

/**
 * E21/E31: async, mime-aware source-text extraction for uploaded files.
 * - DOCX → mammoth plain text (prose has no reliable structure; the model is
 *   the right tool).
 * - XLSX → sheets serialized with their names as headings (E31 "Let AI read
 *   it"); the non-AI spreadsheet import remains the exact-control option.
 * - Legacy .doc/.xls → refused with conversion guidance.
 * - Everything else → the existing sync textFromDataUrl behavior.
 * Neither Office format can reach the "[Binary …]" stub; honest
 * OfficeParseErrors (encrypted/legacy/corrupt/empty) flow through unchanged.
 */
export async function sourceTextFromUpload(dataUrl: string): Promise<string> {
  const m = /^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/i.exec(dataUrl.trim());
  if (!m) return textFromDataUrl(dataUrl);
  const mime = (m[1] || "").toLowerCase();
  if (mime === LEGACY_DOC_MIME || mime === LEGACY_XLS_MIME) {
    throw new OfficeParseError(LEGACY_OFFICE_MESSAGE);
  }
  if (mime === XLSX_MIME) {
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > AGENDA_INGEST_MAX_BYTES) {
      throw new Error(`File exceeds max size of ${AGENDA_INGEST_MAX_BYTES} bytes`);
    }
    return sheetsToSourceText(await xlsxToSheets(buf));
  }
  if (mime === DOCX_MIME) {
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > AGENDA_INGEST_MAX_BYTES) {
      throw new Error(`File exceeds max size of ${AGENDA_INGEST_MAX_BYTES} bytes`);
    }
    return docxToText(buf);
  }
  return textFromDataUrl(dataUrl);
}

export type IngestAttachment = { type: "document" | "image"; mediaType: string; base64: string };

/**
 * Build a multimodal attachment (PDF/image only — the provider types the
 * gateway supports) from a data: URL. Returns null for other mimes.
 * Throws when the decoded payload exceeds AGENDA_INGEST_MAX_BYTES.
 */
export function attachmentFromDataUrl(dataUrl: string): IngestAttachment | null {
  const m = /^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/i.exec(dataUrl.trim());
  if (!m?.[2]) return null;
  const mime = (m[1] || "application/octet-stream").toLowerCase();
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > AGENDA_INGEST_MAX_BYTES) {
    throw new Error(`File exceeds max size of ${AGENDA_INGEST_MAX_BYTES} bytes`);
  }
  if (mime === "application/pdf") {
    return { type: "document", mediaType: "application/pdf", base64: m[2] };
  }
  if (mime.startsWith("image/")) {
    return { type: "image", mediaType: mime, base64: m[2] };
  }
  return null;
}

export async function fetchUrlText(url: string): Promise<{ text: string; mime: string | null }> {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("URL must be http(s)");
  }
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "DocWeekSched-AgendaIngest/1.0" },
  });
  if (!res.ok) throw new Error(`Failed to fetch URL (${res.status})`);
  const mime = res.headers.get("content-type");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > AGENDA_INGEST_MAX_BYTES) {
    throw new Error(`URL body exceeds max size of ${AGENDA_INGEST_MAX_BYTES} bytes`);
  }
  const text = buf.toString("utf8");
  if (mime?.includes("html") || /<html/i.test(text.slice(0, 500))) {
    return { text: htmlToText(text), mime };
  }
  return { text, mime };
}
