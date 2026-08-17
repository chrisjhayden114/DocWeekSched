import type { Readable } from "stream";

export type StoragePutInput = {
  /** Logical object key (no leading slash). */
  key: string;
  body: Buffer;
  contentType: string;
};

export type StoragePutResult = {
  /** Public or data URL to store on the resource. */
  url: string;
  storageKey: string | null;
};

export type StorageAcceptInput = {
  /** Client-provided URL: data:… or https://… */
  url: string;
  /** Optional preferred key prefix, e.g. `events/{id}/resources` */
  keyPrefix?: string;
  maxBytes?: number;
  allowedMimeTypes?: string[];
};

export type StorageGetResult = {
  /** Prefer streaming; Buffer remains for small / data-URL payloads. */
  body: Readable | Buffer;
  contentType: string;
  contentLength?: number;
};

export type StoragePresignPutInput = {
  key: string;
  contentType: string;
  /** Seconds until the URL expires (default ~10 min). */
  expiresInSeconds?: number;
};

export type StoragePresignPutResult = {
  uploadUrl: string;
  /** Headers the client must send on the PUT (at least Content-Type). */
  headers: Record<string, string>;
};

export type StorageHeadResult = {
  contentLength: number;
  contentType: string | null;
};

/**
 * Object-storage provider. When no bucket is configured, the data-URL
 * implementation stores files inline (legacy behavior) so local/dev keeps working.
 */
export interface StorageProvider {
  readonly name: string;
  /** True when uploads go to a real object store (not data-URL fallback). */
  isObjectStore(): boolean;
  put(input: StoragePutInput): Promise<StoragePutResult>;
  acceptUpload(input: StorageAcceptInput): Promise<StoragePutResult>;
  /**
   * Fetch bytes by storage key. Optional — data-URL fallback keeps bytes on
   * the row (`fileUrl`) and returns null here. Used by readiness file proxy (O5).
   * Must stream when possible — do not buffer whole objects in memory.
   */
  get?(key: string): Promise<StorageGetResult | null>;
  /**
   * Mint a client-side PUT URL (SigV4 query-string / getSignedUrl equivalent).
   * Absent or returning null → API tells the client to use the legacy data-URL path.
   */
  presignPut?(input: StoragePresignPutInput): Promise<StoragePresignPutResult | null>;
  /** HeadObject — existence + size. Absent on providers that cannot inspect keys. */
  head?(key: string): Promise<StorageHeadResult | null>;
  /** DeleteObject — used when a direct upload exceeds the cap after HeadObject. */
  deleteObject?(key: string): Promise<void>;
  /** Public (or store) URL for a key already written by a client PUT. */
  urlForKey?(key: string): string;
}
