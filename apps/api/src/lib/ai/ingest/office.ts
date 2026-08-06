/**
 * Server-side Office file parsing for agenda import (Chunk E21).
 *
 * - DOCX → plain text via mammoth, fed to the normal AI extraction path.
 * - XLSX → sheet rows via exceljs, fed to the NON-AI CSV review path.
 *
 * Neither library is trusted to receive well-formed input: a malformed or
 * hostile file must produce an OfficeParseError whose message names the real
 * cause (password-protected, legacy format, corrupt archive, empty document)
 * — never a crash and never a generic "could not process".
 */

import ExcelJS from "exceljs";
import mammoth from "mammoth";

/** User-facing parse failure; `message` is safe to return to the client. */
export class OfficeParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfficeParseError";
  }
}

export const LEGACY_OFFICE_MESSAGE =
  "Legacy .doc/.xls files aren't supported. Save as .docx or .xlsx and upload again.";

export const PASSWORD_PROTECTED_MESSAGE =
  "This file is password-protected. Remove the password (Save As without encryption) and upload again.";

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const LEGACY_DOC_MIME = "application/msword";
export const LEGACY_XLS_MIME = "application/vnd.ms-excel";

/** OOXML files are ZIP archives; legacy and encrypted Office files are CFB. */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const CFB_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

function utf16le(text: string): Buffer {
  return Buffer.from(text, "utf16le");
}

/**
 * Classify a CFB (Compound File Binary) payload by scanning its directory
 * stream names. Encrypted OOXML (a password-protected .docx/.xlsx) is stored
 * as a CFB with an "EncryptionInfo" stream; legacy .doc has "WordDocument";
 * legacy .xls has "Workbook"/"Book".
 */
function classifyCfb(buf: Buffer): "encrypted" | "legacy" | "unknown" {
  if (buf.includes(utf16le("EncryptionInfo")) || buf.includes(utf16le("EncryptedPackage"))) {
    return "encrypted";
  }
  if (
    buf.includes(utf16le("WordDocument")) ||
    buf.includes(utf16le("Workbook")) ||
    buf.includes(utf16le("Book"))
  ) {
    return "legacy";
  }
  return "unknown";
}

/** Throw the honest cause when the payload is not an OOXML ZIP archive. */
function assertOoxmlZip(buf: Buffer, kindLabel: string): void {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(CFB_MAGIC)) {
    const kind = classifyCfb(buf);
    if (kind === "encrypted") throw new OfficeParseError(PASSWORD_PROTECTED_MESSAGE);
    if (kind === "legacy") throw new OfficeParseError(LEGACY_OFFICE_MESSAGE);
    throw new OfficeParseError(
      `This file isn't a readable ${kindLabel} — it may be password-protected or a legacy Office format. ` +
        `Save as ${kindLabel} without a password and upload again.`,
    );
  }
  if (buf.length < 4 || !buf.subarray(0, 4).equals(ZIP_MAGIC)) {
    throw new OfficeParseError(
      `This file isn't a valid ${kindLabel} (the archive is corrupt or it's a different format renamed to ${kindLabel}).`,
    );
  }
}

/** Extract plain text from a .docx buffer. Throws OfficeParseError with the real cause. */
export async function docxToText(buf: Buffer): Promise<string> {
  assertOoxmlZip(buf, ".docx");
  let value: string;
  try {
    const result = await mammoth.extractRawText({ buffer: buf });
    value = result.value;
  } catch {
    throw new OfficeParseError(
      "This .docx couldn't be read — the file appears to be corrupt. Re-save it in Word and upload again.",
    );
  }
  const text = value.replace(/\n{3,}/g, "\n\n").trim();
  if (!text) {
    throw new OfficeParseError(
      "The document contains no readable text — it may be empty or made of images only.",
    );
  }
  return text;
}

export type SpreadsheetSheet = {
  name: string;
  /** Rows of cell strings; trailing empty rows/columns trimmed. */
  rows: string[][];
};

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Excel datetime cells come back from exceljs as JS Dates anchored in UTC.
 * Format them as the wall-clock string the CSV validator accepts
 * ("YYYY-MM-DD HH:MM"), or date-only when the cell has no time component.
 */
function dateCellToString(d: Date): string {
  const date = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0) return date;
  return `${date} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return dateCellToString(value);
  if (typeof value === "object") {
    const v = value as {
      richText?: { text: string }[];
      text?: string | { richText?: { text: string }[] };
      hyperlink?: string;
      result?: ExcelJS.CellValue;
      formula?: string;
      error?: string;
    };
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("").trim();
    if (v.text != null) {
      return typeof v.text === "string"
        ? v.text.trim()
        : (v.text.richText || []).map((t) => t.text).join("").trim();
    }
    if (v.result !== undefined) return cellToString(v.result);
    if (v.hyperlink) return v.hyperlink;
    if (v.error) return "";
  }
  return "";
}

/** Keep the parse (and the JSON response) bounded on hostile/huge workbooks. */
export const SPREADSHEET_MAX_ROWS = 2_000;
export const SPREADSHEET_MAX_COLS = 60;

/**
 * Parse a .xlsx buffer into per-sheet string rows.
 * Throws OfficeParseError with the real cause for anything unreadable.
 */
export async function xlsxToSheets(buf: Buffer): Promise<SpreadsheetSheet[]> {
  assertOoxmlZip(buf, ".xlsx");
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buf as unknown as ExcelJS.Buffer);
  } catch {
    throw new OfficeParseError(
      "This .xlsx couldn't be read — the file appears to be corrupt. Re-save it in Excel and upload again.",
    );
  }

  const sheets: SpreadsheetSheet[] = [];
  for (const ws of workbook.worksheets) {
    const rows: string[][] = [];
    const colCount = Math.min(ws.actualColumnCount || ws.columnCount || 0, SPREADSHEET_MAX_COLS);
    const rowCount = Math.min(ws.rowCount || 0, SPREADSHEET_MAX_ROWS);
    for (let r = 1; r <= rowCount; r += 1) {
      const row = ws.getRow(r);
      const cells: string[] = [];
      for (let c = 1; c <= colCount; c += 1) {
        cells.push(cellToString(row.getCell(c).value));
      }
      rows.push(cells);
    }
    // Trim trailing all-empty rows.
    while (rows.length > 0 && rows[rows.length - 1].every((c) => c === "")) rows.pop();
    if (rows.length > 0) sheets.push({ name: ws.name, rows });
  }

  if (sheets.length === 0) {
    throw new OfficeParseError(
      "The workbook contains no readable rows — every sheet is empty.",
    );
  }
  return sheets;
}

export type SpreadsheetTable = { headers: string[]; rows: Record<string, string>[] };

/**
 * Convert sheet rows to the header + row-object shape the client-side CSV
 * parser produces, so the existing CSV review path (column auto-mapping,
 * per-row validation, explicit confirm) consumes both identically.
 * Throws OfficeParseError naming the cause when the sheet has no usable data.
 */
export function sheetToTable(sheet: SpreadsheetSheet): SpreadsheetTable {
  const headerRowIndex = sheet.rows.findIndex((r) => r.some((c) => c !== ""));
  if (headerRowIndex < 0) {
    throw new OfficeParseError(`Sheet "${sheet.name}" has no readable rows.`);
  }
  const headers = sheet.rows[headerRowIndex].map((h, i) => h || `Column ${i + 1}`);
  const rows = sheet.rows
    .slice(headerRowIndex + 1)
    .filter((cells) => cells.some((c) => c !== ""))
    .map((cells) => {
      const row: Record<string, string> = {};
      headers.forEach((h, i) => {
        row[h] = cells[i] ?? "";
      });
      return row;
    });
  if (rows.length === 0) {
    throw new OfficeParseError(
      `Sheet "${sheet.name}" has a header row but no data rows — add your sessions under the headers.`,
    );
  }
  return { headers, rows };
}
