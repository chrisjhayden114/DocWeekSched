/**
 * Excel (.xlsx) support for the non-AI session import (Chunk E21).
 *
 * The browser cannot parse .xlsx — the Office libraries run server-side only —
 * so the file is posted to POST /import/spreadsheet/parse, which returns
 * headers + rows in the same shape as the client-side CSV parser. Everything
 * after that is the existing CSV review path: column auto-mapping, per-row
 * validation, explicit confirm. No AI involved.
 */

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const LEGACY_XLS_MESSAGE =
  "Legacy .xls files aren't supported. Save as .xlsx and upload again.";
export const LEGACY_DOC_MESSAGE =
  "Legacy .doc files aren't supported. Save as .docx and upload again.";

export function isXlsxFile(name: string, type?: string): boolean {
  return name.toLowerCase().endsWith(".xlsx") || (type || "").includes("spreadsheetml");
}

export function isLegacyExcelFile(name: string, type?: string): boolean {
  return name.toLowerCase().endsWith(".xls") || (type || "") === "application/vnd.ms-excel";
}

export function isLegacyWordFile(name: string, type?: string): boolean {
  return name.toLowerCase().endsWith(".doc") || (type || "") === "application/msword";
}

export type SpreadsheetSheetInfo = { name: string; rowCount: number };

export type SpreadsheetParseResponse = {
  sheets: SpreadsheetSheetInfo[];
  /** True when the workbook has several sheets and none was chosen yet. */
  needsSheetChoice?: boolean;
  sheet?: string;
  headers?: string[];
  rows?: Record<string, string>[];
};

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}
