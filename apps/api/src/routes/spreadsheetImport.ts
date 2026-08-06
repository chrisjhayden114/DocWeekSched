import { Router } from "express";
import { z } from "zod";
import { asyncHandler, HttpError, requireEventAccess } from "../lib/authorization";
import {
  AGENDA_INGEST_MAX_BYTES,
  LEGACY_OFFICE_MESSAGE,
  LEGACY_DOC_MIME,
  LEGACY_XLS_MIME,
  OfficeParseError,
  XLSX_MIME,
  sheetToTable,
  xlsxToSheets,
} from "../lib/ai/ingest";
import type { AuthedRequest } from "../lib/middleware";
import { requireAuth, requireCsrf } from "../lib/middleware";
import { resolveEventFromRequest } from "../lib/requestEvent";
import { validationErrorBody } from "../lib/errors";

/**
 * E21 — server-side Excel parsing for the NON-AI spreadsheet import.
 *
 * The browser cannot parse .xlsx (the Office libraries run server-side only),
 * so it posts the file here and gets back headers + rows in the same shape the
 * client-side CSV parser produces. The client then runs the existing CSV
 * review path — column auto-mapping, per-row validation, explicit confirm.
 * Nothing is created by this endpoint; it only reads the file.
 */
export const spreadsheetImportRouter = Router();

const parseSchema = z.object({
  /** data: URL of the uploaded workbook. */
  fileUrl: z.string().min(1),
  /** Sheet to convert; required only when the workbook has several. */
  sheet: z.string().max(128).optional(),
});

type SheetInfo = { name: string; rowCount: number };

spreadsheetImportRouter.post(
  "/parse",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = parseSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(validationErrorBody(parsed.error));
    }

    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });

    const m = /^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/i.exec(parsed.data.fileUrl.trim());
    if (!m?.[2]) {
      throw new HttpError(400, { error: "Upload must be a data URL" });
    }
    const mime = (m[1] || "").toLowerCase();
    if (mime === LEGACY_DOC_MIME || mime === LEGACY_XLS_MIME) {
      throw new HttpError(400, { error: LEGACY_OFFICE_MESSAGE });
    }
    if (mime && mime !== XLSX_MIME && mime !== "application/octet-stream") {
      throw new HttpError(400, {
        error: `Expected an Excel .xlsx file, got ${mime}. For CSV files, upload them directly.`,
      });
    }
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > AGENDA_INGEST_MAX_BYTES) {
      throw new HttpError(400, {
        error: `File exceeds max size of ${AGENDA_INGEST_MAX_BYTES} bytes`,
      });
    }

    let sheets;
    try {
      sheets = await xlsxToSheets(buf);
    } catch (err) {
      if (err instanceof OfficeParseError) {
        throw new HttpError(400, { error: err.message });
      }
      throw err;
    }

    const sheetInfos: SheetInfo[] = sheets.map((s) => ({ name: s.name, rowCount: s.rows.length }));

    let selected = null;
    if (parsed.data.sheet != null) {
      selected = sheets.find((s) => s.name === parsed.data.sheet) || null;
      if (!selected) {
        throw new HttpError(400, {
          error: `No sheet named "${parsed.data.sheet}" — the workbook has: ${sheetInfos
            .map((s) => s.name)
            .join(", ")}.`,
        });
      }
    } else if (sheets.length === 1) {
      selected = sheets[0];
    }

    // E21: a multi-sheet workbook asks which sheet — never silently take the
    // first. The client shows the chooser and re-posts with `sheet`.
    if (!selected) {
      return res.json({ sheets: sheetInfos, needsSheetChoice: true });
    }

    let table;
    try {
      table = sheetToTable(selected);
    } catch (err) {
      if (err instanceof OfficeParseError) {
        throw new HttpError(400, { error: err.message });
      }
      throw err;
    }

    return res.json({
      sheets: sheetInfos,
      sheet: selected.name,
      headers: table.headers,
      rows: table.rows,
    });
  }),
);
