import { describe, expect, it } from "vitest";
import {
  LEGACY_DOC_MESSAGE,
  LEGACY_XLS_MESSAGE,
  isLegacyExcelFile,
  isLegacyWordFile,
  isXlsxFile,
} from "../lib/spreadsheetImport";

describe("E21 spreadsheet import helpers", () => {
  it("detects .xlsx by extension and by mime", () => {
    expect(isXlsxFile("Programme.XLSX")).toBe(true);
    expect(
      isXlsxFile("upload", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ).toBe(true);
    expect(isXlsxFile("programme.csv", "text/csv")).toBe(false);
    expect(isXlsxFile("programme.xls", "application/vnd.ms-excel")).toBe(false);
  });

  it("detects legacy Office formats by extension and by mime", () => {
    expect(isLegacyExcelFile("book.xls")).toBe(true);
    expect(isLegacyExcelFile("book", "application/vnd.ms-excel")).toBe(true);
    expect(isLegacyExcelFile("book.xlsx")).toBe(false);
    expect(isLegacyWordFile("paper.doc")).toBe(true);
    expect(isLegacyWordFile("paper", "application/msword")).toBe(true);
    expect(isLegacyWordFile("paper.docx")).toBe(false);
  });

  it("legacy rejection copy says what to do, not just no", () => {
    expect(LEGACY_XLS_MESSAGE).toMatch(/Save as \.xlsx/);
    expect(LEGACY_DOC_MESSAGE).toMatch(/Save as \.docx/);
  });
});
