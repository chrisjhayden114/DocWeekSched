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
}
