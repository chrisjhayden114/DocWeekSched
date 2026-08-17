import { createHash, createHmac, randomBytes } from "crypto";
import { Readable } from "stream";
import type {
  StorageAcceptInput,
  StorageGetResult,
  StorageHeadResult,
  StoragePresignPutInput,
  StoragePresignPutResult,
  StorageProvider,
  StoragePutInput,
  StoragePutResult,
} from "./types";

const DEFAULT_MAX = 20_000_000;
const DEFAULT_PRESIGN_SECONDS = 600;

export type S3CompatibleConfig = {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl?: string;
  maxUploadBytes?: number;
};

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function amzDate(d = new Date()): { amz: string; dateStamp: string } {
  const iso = d.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amz: iso, dateStamp: iso.slice(0, 8) };
}

function signingKey(secretAccessKey: string, dateStamp: string, region: string): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

/**
 * Minimal SigV4 PutObject / GetObject / HeadObject / DeleteObject / presigned PUT
 * for S3 / R2 / MinIO — no AWS SDK dependency (getSignedUrl equivalent).
 */
export class S3CompatibleStorageProvider implements StorageProvider {
  readonly name = "s3-compatible";

  constructor(private readonly cfg: S3CompatibleConfig) {}

  isObjectStore(): boolean {
    return true;
  }

  private hostAndPath(key: string): { host: string; url: string; canonicalUri: string } {
    const encodedKey = key
      .split("/")
      .map((p) => encodeURIComponent(p).replace(/%2F/gi, "/"))
      .join("/");
    if (this.cfg.endpoint) {
      const base = this.cfg.endpoint.replace(/\/$/, "");
      const u = new URL(base);
      const path = `/${this.cfg.bucket}/${encodedKey}`;
      return { host: u.host, url: `${base}${path}`, canonicalUri: path };
    }
    const host = `${this.cfg.bucket}.s3.${this.cfg.region}.amazonaws.com`;
    return { host, url: `https://${host}/${encodedKey}`, canonicalUri: `/${encodedKey}` };
  }

  urlForKey(key: string): string {
    if (this.cfg.publicBaseUrl) {
      return `${this.cfg.publicBaseUrl.replace(/\/$/, "")}/${key}`;
    }
    return this.hostAndPath(key).url;
  }

  private async signedFetch(
    method: "GET" | "HEAD" | "DELETE",
    key: string,
  ): Promise<Response> {
    const { host, url, canonicalUri } = this.hostAndPath(key);
    const { amz, dateStamp } = amzDate();
    const payloadHash = sha256Hex("");
    const canonicalHeaders = `host:${host}\n` + `x-amz-content-sha256:${payloadHash}\n` + `x-amz-date:${amz}\n`;
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
    const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join(
      "\n",
    );
    const credentialScope = `${dateStamp}/${this.cfg.region}/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amz, credentialScope, sha256Hex(canonicalRequest)].join("\n");
    const signature = createHmac("sha256", signingKey(this.cfg.secretAccessKey, dateStamp, this.cfg.region))
      .update(stringToSign, "utf8")
      .digest("hex");
    const authorization =
      `AWS4-HMAC-SHA256 Credential=${this.cfg.accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return fetch(url, {
      method,
      headers: {
        Host: host,
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amz,
        Authorization: authorization,
      },
    });
  }

  async put(input: StoragePutInput): Promise<StoragePutResult> {
    const { host, url, canonicalUri } = this.hostAndPath(input.key);
    const { amz, dateStamp } = amzDate();
    const payloadHash = sha256Hex(input.body);
    const canonicalHeaders =
      `content-type:${input.contentType}\n` + `host:${host}\n` + `x-amz-content-sha256:${payloadHash}\n` + `x-amz-date:${amz}\n`;
    const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
    const canonicalRequest = ["PUT", canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const credentialScope = `${dateStamp}/${this.cfg.region}/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amz, credentialScope, sha256Hex(canonicalRequest)].join("\n");
    const signature = createHmac("sha256", signingKey(this.cfg.secretAccessKey, dateStamp, this.cfg.region))
      .update(stringToSign, "utf8")
      .digest("hex");
    const authorization =
      `AWS4-HMAC-SHA256 Credential=${this.cfg.accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const res = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": input.contentType,
        Host: host,
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amz,
        Authorization: authorization,
      },
      body: new Uint8Array(input.body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Object storage upload failed (${res.status}): ${text.slice(0, 200)}`);
    }
    return { url: this.urlForKey(input.key), storageKey: input.key };
  }

  async acceptUpload(input: StorageAcceptInput): Promise<StoragePutResult> {
    const max = input.maxBytes ?? this.cfg.maxUploadBytes ?? DEFAULT_MAX;
    const trimmed = input.url.trim();

    if (/^https?:\/\//i.test(trimmed) && !trimmed.startsWith("data:")) {
      // Already hosted (e.g. prior upload or external link)
      return { url: trimmed, storageKey: null };
    }

    const m = /^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/i.exec(trimmed);
    if (!m) {
      throw new Error("Upload must be a data URL or https URL");
    }
    const mime = (m[1] || "application/octet-stream").toLowerCase();
    const buffer = Buffer.from(m[2], "base64");
    if (buffer.length > max) {
      throw new Error(`File exceeds max size of ${max} bytes`);
    }
    if (input.allowedMimeTypes?.length && !input.allowedMimeTypes.includes(mime)) {
      throw new Error(`MIME type not allowed: ${mime}`);
    }

    const ext = mime.split("/")[1]?.replace(/[^a-z0-9]+/gi, "") || "bin";
    const key = `${input.keyPrefix || "uploads"}/${randomBytes(12).toString("hex")}.${ext}`;
    return this.put({ key, body: buffer, contentType: mime });
  }

  /**
   * Query-string presigned PUT (content-type signed). Client must send the same
   * Content-Type header. Expiry defaults to 10 minutes.
   */
  async presignPut(input: StoragePresignPutInput): Promise<StoragePresignPutResult> {
    const expiresIn = Math.max(60, Math.min(input.expiresInSeconds ?? DEFAULT_PRESIGN_SECONDS, 3600));
    const { host, url, canonicalUri } = this.hostAndPath(input.key);
    const { amz, dateStamp } = amzDate();
    const credentialScope = `${dateStamp}/${this.cfg.region}/s3/aws4_request`;
    const credential = `${this.cfg.accessKeyId}/${credentialScope}`;
    const signedHeaders = "content-type;host";
    const canonicalQuery = [
      `X-Amz-Algorithm=AWS4-HMAC-SHA256`,
      `X-Amz-Credential=${encodeURIComponent(credential)}`,
      `X-Amz-Date=${amz}`,
      `X-Amz-Expires=${expiresIn}`,
      `X-Amz-SignedHeaders=${encodeURIComponent(signedHeaders)}`,
    ].join("&");
    const canonicalHeaders = `content-type:${input.contentType}\n` + `host:${host}\n`;
    const canonicalRequest = [
      "PUT",
      canonicalUri,
      canonicalQuery,
      canonicalHeaders,
      signedHeaders,
      "UNSIGNED-PAYLOAD",
    ].join("\n");
    const stringToSign = ["AWS4-HMAC-SHA256", amz, credentialScope, sha256Hex(canonicalRequest)].join("\n");
    const signature = createHmac("sha256", signingKey(this.cfg.secretAccessKey, dateStamp, this.cfg.region))
      .update(stringToSign, "utf8")
      .digest("hex");
    return {
      uploadUrl: `${url}?${canonicalQuery}&X-Amz-Signature=${signature}`,
      headers: { "Content-Type": input.contentType },
    };
  }

  async head(key: string): Promise<StorageHeadResult | null> {
    const res = await this.signedFetch("HEAD", key);
    if (res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Object storage head failed (${res.status}): ${text.slice(0, 200)}`);
    }
    const lenRaw = res.headers.get("content-length");
    const contentLength = lenRaw != null ? Number(lenRaw) : NaN;
    if (!Number.isFinite(contentLength) || contentLength < 0) {
      throw new Error("Object storage head missing content-length");
    }
    return {
      contentLength,
      contentType: res.headers.get("content-type"),
    };
  }

  async deleteObject(key: string): Promise<void> {
    const res = await this.signedFetch("DELETE", key);
    if (res.status === 404) return;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Object storage delete failed (${res.status}): ${text.slice(0, 200)}`);
    }
  }

  /** O5 — stream bytes by key so the API can proxy without buffering whole objects. */
  async get(key: string): Promise<StorageGetResult | null> {
    const res = await this.signedFetch("GET", key);
    if (res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Object storage get failed (${res.status}): ${text.slice(0, 200)}`);
    }
    const contentType = res.headers.get("content-type") || "application/octet-stream";
    const lenRaw = res.headers.get("content-length");
    const contentLength = lenRaw != null && Number.isFinite(Number(lenRaw)) ? Number(lenRaw) : undefined;
    if (!res.body) {
      return { body: Buffer.alloc(0), contentType, contentLength: 0 };
    }
    const body = Readable.fromWeb(res.body as import("stream/web").ReadableStream);
    return { body, contentType, contentLength };
  }
}
