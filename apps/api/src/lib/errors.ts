import type { ZodError } from "zod";
import { HttpError } from "./authorization";
import { log } from "./log";

/**
 * Canonical client-facing error shape (Phase 7 Chunk C):
 *
 *   { error: string, code?: string, details?: Record<string, string[]> }
 *
 * `error` is ALWAYS a human-readable string (the web client renders it
 * directly); machine-readable discriminators go in `code`; zod field paths
 * live in `details`. Never put objects in `error` and never echo raw
 * Error#message from internals — log the detail server-side instead.
 */
export type ErrorBody = {
  error: string;
  code?: string;
  details?: Record<string, string[]>;
};

/**
 * Standard 400 body for zod parse failures. Field paths are preserved as
 * `details` keys; object-level (refine) messages land under `details._form`.
 */
export function validationErrorBody(zodError: ZodError, message = "Invalid input"): ErrorBody {
  const flat = zodError.flatten();
  const details: Record<string, string[]> = {};
  for (const [field, messages] of Object.entries(flat.fieldErrors)) {
    if (messages && messages.length > 0) details[field] = messages as string[];
  }
  if (flat.formErrors.length > 0) details._form = flat.formErrors;
  return { error: message, code: "VALIDATION", details };
}

/**
 * Map storage/upload failures to typed client errors with safe copy.
 * Known validation cases (size, MIME, shape) get specific messages; everything
 * else is logged server-side and returned as a generic upload failure.
 */
export function uploadHttpError(err: unknown, requestId?: string): HttpError {
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (/File exceeds max size/i.test(message)) {
    return new HttpError(400, { error: "File is too large.", code: "FILE_TOO_LARGE" });
  }
  if (/MIME type not allowed/i.test(message)) {
    return new HttpError(400, { error: "That file type is not allowed.", code: "MIME_NOT_ALLOWED" });
  }
  if (/Invalid data URL|must be a data URL|External URL too long/i.test(message)) {
    return new HttpError(400, { error: "Invalid upload.", code: "INVALID_UPLOAD" });
  }
  log("warn", "upload failed", { requestId, detail: message });
  return new HttpError(400, { error: "Upload failed.", code: "UPLOAD_FAILED" });
}

/** Safe client-facing message for a failed/dead background job (never the raw handler string). */
export function publicJobErrorMessage(status: string, hasError: boolean): string | null {
  if (!hasError) return null;
  if (status === "DEAD") return "Job failed permanently. Retry or contact support if this persists.";
  if (status === "FAILED") return "Job failed. It will retry automatically.";
  return "Job failed.";
}
