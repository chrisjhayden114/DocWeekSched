import { DataUrlStorageProvider } from "./dataUrl";
import { S3CompatibleStorageProvider } from "./s3Compatible";
import type { StorageProvider } from "./types";

export type { StorageProvider, StoragePutResult, StorageAcceptInput } from "./types";

let cached: StorageProvider | null = null;

/**
 * Resolve the storage provider once per process.
 * Object store when STORAGE_BUCKET (+ credentials) are set; otherwise data-URL fallback.
 */
export function getStorageProvider(): StorageProvider {
  if (cached) return cached;

  const bucket = process.env.STORAGE_BUCKET?.trim();
  const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY?.trim();
  const providerName = (process.env.STORAGE_PROVIDER || "").trim().toLowerCase();

  if (bucket && accessKeyId && secretAccessKey && providerName !== "data-url") {
    cached = new S3CompatibleStorageProvider({
      bucket,
      region: process.env.STORAGE_REGION?.trim() || "auto",
      endpoint: process.env.STORAGE_ENDPOINT?.trim() || undefined,
      accessKeyId,
      secretAccessKey,
      publicBaseUrl: process.env.STORAGE_PUBLIC_BASE_URL?.trim() || undefined,
      maxUploadBytes: Number(process.env.STORAGE_MAX_UPLOAD_BYTES || 20_000_000),
    });
    return cached;
  }

  cached = new DataUrlStorageProvider();
  return cached;
}

/** Test helper — reset cached provider after env changes. */
export function resetStorageProviderForTests(): void {
  cached = null;
}
