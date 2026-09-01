import { describe, expect, it } from "vitest";
import { S3CompatibleStorageProvider } from "../lib/storage/s3Compatible";
import { DataUrlStorageProvider } from "../lib/storage/dataUrl";

describe("S3CompatibleStorageProvider.presignPut (ER4.3)", () => {
  const provider = new S3CompatibleStorageProvider({
    bucket: "readyhall-uploads",
    region: "auto",
    endpoint: "https://example.r2.cloudflarestorage.com",
    accessKeyId: "AKIA_TEST",
    secretAccessKey: "secret_test_key_value",
    publicBaseUrl: "https://cdn.example.com",
  });

  it("returns a signed PUT URL with content-type and ~10 min expiry", async () => {
    const result = await provider.presignPut({
      key: "events/e1/readiness/a1/abc.pdf",
      contentType: "application/pdf",
      expiresInSeconds: 600,
    });
    expect(result.headers["Content-Type"]).toBe("application/pdf");
    const url = new URL(result.uploadUrl);
    expect(url.origin).toBe("https://example.r2.cloudflarestorage.com");
    expect(url.pathname).toContain("/readyhall-uploads/events/e1/readiness/a1/abc.pdf");
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-type;host");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("urlForKey uses publicBaseUrl when set", () => {
    expect(provider.urlForKey("events/e1/readiness/a1/abc.pdf")).toBe(
      "https://cdn.example.com/events/e1/readiness/a1/abc.pdf",
    );
  });
});

describe("DataUrlStorageProvider cannot presign", () => {
  it("has no presignPut method so API returns fallback", () => {
    const p = new DataUrlStorageProvider();
    expect(typeof (p as { presignPut?: unknown }).presignPut).toBe("undefined");
    expect(p.isObjectStore()).toBe(false);
  });
});
