import { readFileSync } from "fs";
import { resolve } from "path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  DOCX_MIME,
  LEGACY_DOC_MIME,
  LEGACY_OFFICE_MESSAGE,
  LEGACY_XLS_MIME,
  OfficeParseError,
  PASSWORD_PROTECTED_MESSAGE,
  XLSX_MIME,
  XLSX_USE_SPREADSHEET_IMPORT_MESSAGE,
  docxToText,
  sheetToTable,
  sourceTextFromUpload,
  xlsxToSheets,
} from "../lib/ai/ingest";

const DOCX_FIXTURE = resolve(__dirname, "fixtures/e21-program.docx");

/** CFB container signature + a UTF-16LE stream name, padded to sniff size. */
function fakeCfb(streamName: string): Buffer {
  return Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.alloc(64),
    Buffer.from(streamName, "utf16le"),
    Buffer.alloc(64),
  ]);
}

async function buildXlsx(build: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

describe("E21 office ingest (unit)", () => {
  it("extracts real text from a real .docx", async () => {
    const text = await docxToText(readFileSync(DOCX_FIXTURE));
    expect(text).toContain("2027 Doctoral Week Programme");
    expect(text).toContain("9:00-10:15 Welcome and Programme Updates - Hall A");
    expect(text).not.toContain("[Binary");
  });

  it("sourceTextFromUpload routes DOCX through mammoth — never the binary stub", async () => {
    const b64 = readFileSync(DOCX_FIXTURE).toString("base64");
    const text = await sourceTextFromUpload(`data:${DOCX_MIME};base64,${b64}`);
    expect(text).toContain("Research Design Workshop");
    expect(text).not.toContain("[Binary");
  });

  it("sourceTextFromUpload refuses XLSX — spreadsheets never go to the model", async () => {
    const buf = await buildXlsx((wb) => {
      const ws = wb.addWorksheet("Programme");
      ws.addRow(["title", "start"]);
      ws.addRow(["Welcome", "2027-06-14 09:00"]);
    });
    await expect(
      sourceTextFromUpload(`data:${XLSX_MIME};base64,${buf.toString("base64")}`),
    ).rejects.toThrow(XLSX_USE_SPREADSHEET_IMPORT_MESSAGE);
  });

  it("legacy .doc/.xls mimes get conversion guidance, not a generic rejection", async () => {
    for (const mime of [LEGACY_DOC_MIME, LEGACY_XLS_MIME]) {
      await expect(sourceTextFromUpload(`data:${mime};base64,${Buffer.from("x").toString("base64")}`)).rejects.toThrow(
        LEGACY_OFFICE_MESSAGE,
      );
    }
  });

  it("a password-protected (encrypted CFB) file names its real cause", async () => {
    await expect(docxToText(fakeCfb("EncryptionInfo"))).rejects.toThrow(PASSWORD_PROTECTED_MESSAGE);
    await expect(xlsxToSheets(fakeCfb("EncryptedPackage"))).rejects.toThrow(
      PASSWORD_PROTECTED_MESSAGE,
    );
  });

  it("a legacy binary payload renamed to .docx/.xlsx names the legacy cause", async () => {
    await expect(docxToText(fakeCfb("WordDocument"))).rejects.toThrow(LEGACY_OFFICE_MESSAGE);
    await expect(xlsxToSheets(fakeCfb("Workbook"))).rejects.toThrow(LEGACY_OFFICE_MESSAGE);
  });

  it("a corrupt archive names the corruption, not a generic failure", async () => {
    const notZip = Buffer.from("this is not a zip archive at all");
    await expect(docxToText(notZip)).rejects.toThrow(/isn't a valid \.docx/);
    await expect(xlsxToSheets(notZip)).rejects.toThrow(/isn't a valid \.xlsx/);

    const truncatedZip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(16)]);
    await expect(docxToText(truncatedZip)).rejects.toThrow(/appears to be corrupt/);
    await expect(xlsxToSheets(truncatedZip)).rejects.toThrow(/appears to be corrupt/);
  });

  it("parses a single-sheet workbook into string rows (dates as YYYY-MM-DD HH:MM)", async () => {
    const buf = await buildXlsx((wb) => {
      const ws = wb.addWorksheet("Sessions");
      ws.addRow(["title", "start", "end", "room"]);
      ws.addRow(["Welcome", new Date(Date.UTC(2027, 5, 14, 9, 0)), new Date(Date.UTC(2027, 5, 14, 10, 15)), "Hall A"]);
      ws.addRow(["Lunch", "2027-06-14 12:00", "2027-06-14 13:00", ""]);
    });
    const sheets = await xlsxToSheets(buf);
    expect(sheets).toHaveLength(1);
    expect(sheets[0].name).toBe("Sessions");
    expect(sheets[0].rows[0]).toEqual(["title", "start", "end", "room"]);
    expect(sheets[0].rows[1]).toEqual(["Welcome", "2027-06-14 09:00", "2027-06-14 10:15", "Hall A"]);
    expect(sheets[0].rows[2]).toEqual(["Lunch", "2027-06-14 12:00", "2027-06-14 13:00", ""]);
  });

  it("a multi-sheet workbook returns every non-empty sheet by name", async () => {
    const buf = await buildXlsx((wb) => {
      const day1 = wb.addWorksheet("Day 1");
      day1.addRow(["title"]);
      day1.addRow(["Opening"]);
      const day2 = wb.addWorksheet("Day 2");
      day2.addRow(["title"]);
      day2.addRow(["Closing"]);
      wb.addWorksheet("Empty"); // no rows — dropped
    });
    const sheets = await xlsxToSheets(buf);
    expect(sheets.map((s) => s.name)).toEqual(["Day 1", "Day 2"]);
  });

  it("an all-empty workbook names emptiness as the cause", async () => {
    const buf = await buildXlsx((wb) => {
      wb.addWorksheet("Sheet1");
    });
    await expect(xlsxToSheets(buf)).rejects.toThrow(/no readable rows/);
  });

  it("rich text, formula results and hyperlinks flatten to plain strings", async () => {
    const buf = await buildXlsx((wb) => {
      const ws = wb.addWorksheet("Mixed");
      ws.addRow(["title", "speakers"]);
      ws.getCell("A2").value = { richText: [{ text: "Key" }, { text: "note" }] };
      ws.getCell("B2").value = { formula: "CONCAT()", result: "Dr. Chen" } as ExcelJS.CellValue;
      ws.getCell("A3").value = { text: "Slides", hyperlink: "https://example.com" } as ExcelJS.CellValue;
      ws.getCell("B3").value = 42;
    });
    const sheets = await xlsxToSheets(buf);
    expect(sheets[0].rows[1]).toEqual(["Keynote", "Dr. Chen"]);
    expect(sheets[0].rows[2]).toEqual(["Slides", "42"]);
  });

  it("sheetToTable maps rows to the CSV-parser shape, skipping leading/blank rows", () => {
    const table = sheetToTable({
      name: "Programme",
      rows: [
        ["", "", ""], // decorative blank row above the headers
        ["title", "start", ""],
        ["Welcome", "2027-06-14 09:00", "ignored"],
        ["", "", ""], // blank row inside the data — dropped
        ["Lunch", "2027-06-14 12:00", ""],
      ],
    });
    expect(table.headers).toEqual(["title", "start", "Column 3"]);
    expect(table.rows).toEqual([
      { title: "Welcome", start: "2027-06-14 09:00", "Column 3": "ignored" },
      { title: "Lunch", start: "2027-06-14 12:00", "Column 3": "" },
    ]);
  });

  it("sheetToTable names header-only and empty sheets as the cause", () => {
    expect(() => sheetToTable({ name: "S", rows: [["title", "start"]] })).toThrow(
      /header row but no data rows/,
    );
    expect(() => sheetToTable({ name: "S", rows: [["", ""]] })).toThrow(/no readable rows/);
  });

  it("empty .docx (no readable text) names emptiness as the cause", async () => {
    const empty = readFileSync(resolve(__dirname, "fixtures/e21-empty.docx"));
    const err = await docxToText(empty).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(OfficeParseError);
    expect((err as Error).message).toMatch(/no readable text/);
  });
});
