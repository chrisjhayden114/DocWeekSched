export const AGENDA_INGEST_MAX_BYTES = 20_000_000;
export const AGENDA_INGEST_JOB_TYPE = "ai.agenda_ingest";

export const INGEST_ALLOWED_MIME: string[] = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "text/plain",
  "text/html",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];
