import { HttpError } from "../authorization";
import { getStorageProvider } from "../storage";
import type { StorageGetResult } from "../storage/types";

/** O10 — CFP allowlist (PDF / DOCX / images). */
export const READINESS_DEFAULT_MIME = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
] as const;

/** O10 — default file cap (CFP). */
export const READINESS_DEFAULT_MAX_BYTES = 10_000_000;

/** O10 — deck-type requirements may use the storage cap. */
export const READINESS_DECK_MAX_BYTES = Number(process.env.STORAGE_MAX_UPLOAD_BYTES || 20_000_000);

export function isDeckRequirement(config: Record<string, unknown> | null | undefined): boolean {
  if (!config) return false;
  if (config.deck === true || config.isDeck === true) return true;
  if (typeof config.role === "string" && config.role.toLowerCase() === "deck") return true;
  if (typeof config.kind === "string" && config.kind.toLowerCase() === "deck") return true;
  return false;
}

export function fileRulesForRequirement(config: Record<string, unknown> | null | undefined): {
  maxBytes: number;
  allowedMimeTypes: string[];
  deck: boolean;
} {
  const deck = isDeckRequirement(config);
  const configuredMax =
    typeof config?.maxBytes === "number" && Number.isFinite(config.maxBytes) && config.maxBytes > 0
      ? Math.floor(config.maxBytes)
      : null;
  const configuredMime = Array.isArray(config?.allowedMimeTypes)
    ? config.allowedMimeTypes.filter((m): m is string => typeof m === "string" && m.length > 0)
    : null;
  const cap = deck ? READINESS_DECK_MAX_BYTES : READINESS_DEFAULT_MAX_BYTES;
  return {
    deck,
    maxBytes: configuredMax ? Math.min(configuredMax, READINESS_DECK_MAX_BYTES) : cap,
    allowedMimeTypes: configuredMime && configuredMime.length > 0 ? configuredMime : [...READINESS_DEFAULT_MIME],
  };
}

function parseDataUrl(url: string): { mime: string; buffer: Buffer } | null {
  const m = /^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/i.exec(url.trim());
  if (!m) return null;
  const mime = (m[1] || "application/octet-stream").toLowerCase();
  try {
    return { mime, buffer: Buffer.from(m[2], "base64") };
  } catch {
    return null;
  }
}

/**
 * Enforce O10 allowlist + size BEFORE storage. Throws honest 400s.
 * Returns the parsed buffer so the caller can persist size without re-decoding.
 */
export function assertFileAllowed(input: {
  fileUrl: string;
  mime?: string | null;
  config?: Record<string, unknown> | null;
}): { mime: string; buffer: Buffer; sizeBytes: number } {
  const rules = fileRulesForRequirement(input.config ?? {});
  const trimmed = input.fileUrl.trim();
  if (!trimmed.startsWith("data:")) {
    throw new HttpError(400, {
      error: "Upload a file from your device — remote URLs are not accepted.",
      reason: "wrong_type",
    });
  }
  const parsed = parseDataUrl(trimmed);
  if (!parsed) {
    throw new HttpError(400, { error: "That file could not be read.", reason: "invalid_file" });
  }
  const mime = (input.mime?.trim().toLowerCase() || parsed.mime).toLowerCase();
  if (!rules.allowedMimeTypes.includes(mime) && !rules.allowedMimeTypes.includes(parsed.mime)) {
    throw new HttpError(400, {
      error: "This file type isn't accepted. Use PDF, DOCX, or an image (PNG or JPEG).",
      reason: "wrong_type",
    });
  }
  if (parsed.buffer.length > rules.maxBytes) {
    const mb = Math.round(rules.maxBytes / 1_000_000);
    throw new HttpError(400, {
      error: `This file is too large. Maximum size is ${mb} MB.`,
      reason: "too_large",
    });
  }
  return { mime: parsed.mime, buffer: parsed.buffer, sizeBytes: parsed.buffer.length };
}

export async function readStoredFile(input: {
  fileUrl: string | null;
  fileStorageKey: string | null;
  fileMime: string | null;
}): Promise<StorageGetResult | null> {
  const provider = getStorageProvider();
  if (input.fileStorageKey && typeof provider.get === "function") {
    const fromStore = await provider.get(input.fileStorageKey);
    if (fromStore) {
      return {
        body: fromStore.body,
        contentType: fromStore.contentType || input.fileMime || "application/octet-stream",
      };
    }
  }
  if (input.fileUrl?.startsWith("data:")) {
    const parsed = parseDataUrl(input.fileUrl);
    if (!parsed) return null;
    return { body: parsed.buffer, contentType: input.fileMime || parsed.mime };
  }
  return null;
}

export function contentDisposition(fileName: string | null | undefined): string {
  const raw = (fileName || "submission").replace(/[\r\n"]/g, "");
  const fallback = raw.replace(/[^\x20-\x7E]/g, "_") || "submission";
  return `inline; filename="${fallback}"`;
}
