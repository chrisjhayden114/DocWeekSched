import type { SpreadsheetSheet } from "./office";

/**
 * E31: serialize parsed workbook sheets into the AI extractor's sourceText.
 * The "## Sheet: <name>" heading is the whole point — sheet names often carry
 * the timeslot (e.g. "Breakout Session 1 (10.00–11.00)") that the grid itself
 * omits. Output is compact and deterministic: rows joined with " | ",
 * fully-empty rows skipped, and internal newlines in cells collapsed to "; "
 * so a multi-line Facilitator cell stays on one row.
 */
export function sheetsToSourceText(sheets: SpreadsheetSheet[]): string {
  return sheets
    .map((sheet) => {
      const lines = sheet.rows
        .filter((cells) => cells.some((c) => c.trim() !== ""))
        .map((cells) => {
          const trimmed = [...cells];
          while (trimmed.length > 0 && trimmed[trimmed.length - 1].trim() === "") trimmed.pop();
          return trimmed
            .map((c) => c.replace(/\s*\r?\n\s*/g, "; ").trim())
            .join(" | ");
        });
      return [`## Sheet: ${sheet.name}`, ...lines].join("\n");
    })
    .join("\n\n");
}
