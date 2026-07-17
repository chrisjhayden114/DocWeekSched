import { randomBytes } from "crypto";
import type { StorageAcceptInput, StorageProvider, StoragePutInput, StoragePutResult } from "./types";

const DEFAULT_MAX = 4_500_000;

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

export class DataUrlStorageProvider implements StorageProvider {
  readonly name = "data-url";

  isObjectStore(): boolean {
    return false;
  }

  async put(input: StoragePutInput): Promise<StoragePutResult> {
    const b64 = input.body.toString("base64");
    const url = `data:${input.contentType};base64,${b64}`;
    return { url, storageKey: null };
  }

  async acceptUpload(input: StorageAcceptInput): Promise<StoragePutResult> {
    const max = input.maxBytes ?? DEFAULT_MAX;
    const trimmed = input.url.trim();

    if (/^https?:\/\//i.test(trimmed)) {
      if (trimmed.length > 8_000) {
        throw new Error("External URL too long");
      }
      return { url: trimmed, storageKey: null };
    }

    if (!trimmed.startsWith("data:")) {
      throw new Error("Upload must be a data URL or https URL");
    }
    if (trimmed.length > max * 1.4) {
      throw new Error(`File exceeds max size of ${max} bytes`);
    }

    const parsed = parseDataUrl(trimmed);
    if (!parsed) {
      throw new Error("Invalid data URL");
    }
    if (parsed.buffer.length > max) {
      throw new Error(`File exceeds max size of ${max} bytes`);
    }
    if (input.allowedMimeTypes?.length && !input.allowedMimeTypes.includes(parsed.mime)) {
      throw new Error(`MIME type not allowed: ${parsed.mime}`);
    }

    // Keep as data URL; optional synthetic key for forward-compat.
    const key = `${input.keyPrefix || "uploads"}/${randomBytes(8).toString("hex")}`;
    return { url: trimmed, storageKey: key };
  }
}
