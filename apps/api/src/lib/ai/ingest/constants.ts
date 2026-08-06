export const AGENDA_INGEST_MAX_BYTES = 20_000_000;
export const AGENDA_INGEST_JOB_TYPE = "ai.agenda_ingest";

// E21: legacy application/msword and application/vnd.ms-excel are gone —
// mammoth/exceljs read only the OOXML formats, and advertising formats that
// silently fail is the defect this chunk exists to fix. Uploading one gets
// conversion guidance (LEGACY_OFFICE_MESSAGE), not a generic rejection.
export const INGEST_ALLOWED_MIME: string[] = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
  "text/html",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];
