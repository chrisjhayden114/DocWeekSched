/**
 * Ingest "Source" panel + review heading helpers (Chunk E11.1 / E11.2).
 *
 * For binary uploads the API stores an internal placeholder in
 * `sourceTextPreview` (e.g. "[Binary application/pdf upload, 188181 bytes —
 * extract from stored bytes / OCR stub]"). That is an implementation detail
 * and must never reach the UI — file-sourced runs show the real metadata
 * (file name, type, size) instead.
 */

export type IngestSourceRun = {
  sourceKind: string;
  sourceFileName?: string | null;
  sourceMime?: string | null;
  sourceBytes?: number | null;
  sourceTextPreview?: string | null;
};

export type IngestSourceDisplay = {
  /** True for uploaded-file runs (PDF/DOCX/XLSX/CSV/IMAGE). */
  isFile: boolean;
  fileName: string | null;
  mime: string | null;
  sizeLabel: string | null;
  /** Genuine text preview, or null when only the internal stub exists. */
  previewText: string | null;
  /** Honest replacement when no text preview exists for a binary format. */
  previewNote: string | null;
};

const FILE_KINDS = new Set(["PDF", "DOCX", "XLSX", "CSV", "IMAGE"]);

/** Internal placeholders from the API's textFromDataUrl / stored-file paths. */
const BINARY_STUB = /^\[(Binary .+ upload|Stored file )/;

export const NO_PREVIEW_NOTE = "No text preview — the file was read directly by the model.";

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  const label = value >= 100 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "");
  return `${label} ${units[unit]}`;
}

export function describeIngestSource(run: IngestSourceRun): IngestSourceDisplay {
  const rawPreview = (run.sourceTextPreview || "").trim();
  const isStub = BINARY_STUB.test(rawPreview);
  const previewText = rawPreview && !isStub ? rawPreview : null;
  const isFile = FILE_KINDS.has(run.sourceKind);

  if (!isFile) {
    // PASTE / URL: the text preview is the genuine source and stays useful.
    return {
      isFile: false,
      fileName: null,
      mime: null,
      sizeLabel: null,
      previewText,
      previewNote: null,
    };
  }

  return {
    isFile: true,
    fileName: run.sourceFileName || null,
    mime: run.sourceMime || null,
    sizeLabel: run.sourceBytes != null ? formatBytes(run.sourceBytes) : null,
    previewText,
    previewNote: previewText ? null : NO_PREVIEW_NOTE,
  };
}

/** Human name for where a run's content came from (E11.2 / E30.4). */
export function ingestSourceName(sourceKind: string, fileName?: string | null): string {
  if (sourceKind === "GENERATED") return "your description";
  return (
    fileName ||
    (sourceKind === "PASTE" ? "pasted text" : sourceKind === "URL" ? "the fetched URL" : "your upload")
  );
}

/**
 * H-GEN: history/labels for a run's source kind. GENERATED runs came from the
 * structured "describe your event" form — no file metadata to show.
 */
export function ingestSourceKindLabel(sourceKind: string): string {
  return sourceKind === "GENERATED" ? "Described event" : sourceKind;
}

/**
 * Review-panel heading that states the outcome plainly and names the source,
 * so the connection to the upload is unmistakable (E11.2).
 */
export function ingestReviewHeading(input: {
  confirmed?: boolean;
  creates: number;
  updates: number;
  /** W-7 — ambiguous matches are sessions found too, however they resolve. */
  decisions?: number;
  sourceKind: string;
  fileName?: string | null;
}): string {
  if (input.confirmed) return "Confirmed drafts";
  const found = input.creates + input.updates + (input.decisions || 0);
  const source = ingestSourceName(input.sourceKind, input.fileName);
  // H-GEN: generated skeletons were drafted, not found — the heading says so.
  if (input.sourceKind === "GENERATED") {
    if (found === 0) return "No sessions drafted from your description";
    return `Review ${found} session${found === 1 ? "" : "s"} drafted from your description`;
  }
  if (found === 0) return `No sessions found in ${source}`;
  return `Review ${found} session${found === 1 ? "" : "s"} found in ${source}`;
}
