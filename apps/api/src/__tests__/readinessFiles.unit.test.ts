import { describe, expect, it } from "vitest";
import {
  assertFileAllowed,
  assertUploadMetaAllowed,
  contentDisposition,
  fileRulesForRequirement,
  isReadinessKeyScoped,
  mintReadinessObjectKey,
  readinessFileDisposition,
  READINESS_DATA_URL_MAX_BYTES,
  READINESS_DECK_MAX_BYTES,
  READINESS_DEFAULT_MAX_BYTES,
  READINESS_DEFAULT_MIME,
} from "../lib/readiness/files";

describe("readiness file rules (ER4.3 / O10)", () => {
  it("defaults to the deck allowlist and 250 MB storage cap", () => {
    const rules = fileRulesForRequirement({});
    expect(rules.maxBytes).toBe(READINESS_DEFAULT_MAX_BYTES);
    expect(rules.maxBytes).toBe(READINESS_DECK_MAX_BYTES);
    expect(READINESS_DECK_MAX_BYTES).toBeGreaterThanOrEqual(250_000_000);
    expect(rules.allowedMimeTypes).toEqual([...READINESS_DEFAULT_MIME]);
    expect(rules.allowedMimeTypes).toContain("application/pdf");
    expect(rules.allowedMimeTypes).toContain("application/vnd.ms-powerpoint");
    expect(rules.allowedMimeTypes).toContain(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    expect(rules.allowedMimeTypes).toContain(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(rules.allowedMimeTypes).toContain("image/png");
  });

  it("still recognizes deck markers and honors per-requirement overrides", () => {
    expect(fileRulesForRequirement({ deck: true }).deck).toBe(true);
    expect(fileRulesForRequirement({ deck: true }).maxBytes).toBe(READINESS_DECK_MAX_BYTES);
    expect(fileRulesForRequirement({ isDeck: true }).deck).toBe(true);
    expect(fileRulesForRequirement({ role: "deck" }).deck).toBe(true);
    expect(fileRulesForRequirement({ maxBytes: 1_000_000 }).maxBytes).toBe(1_000_000);
    expect(fileRulesForRequirement({ allowedMimeTypes: ["application/pdf"] }).allowedMimeTypes).toEqual([
      "application/pdf",
    ]);
  });

  it("accepts PowerPoint MIME and octet-stream via extension fallback", () => {
    const tiny = Buffer.from("hello").toString("base64");
    expect(
      assertFileAllowed({
        fileUrl: `data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,${tiny}`,
        mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        fileName: "talk.pptx",
      }).mime,
    ).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");

    expect(
      assertFileAllowed({
        fileUrl: `data:application/octet-stream;base64,${tiny}`,
        mime: "application/octet-stream",
        fileName: "talk.pptx",
      }).mime,
    ).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");

    expect(
      assertFileAllowed({
        fileUrl: `data:application/octet-stream;base64,${tiny}`,
        mime: "application/octet-stream",
        fileName: "legacy.ppt",
      }).mime,
    ).toBe("application/vnd.ms-powerpoint");
  });

  it("rejects the wrong MIME and an oversized payload before storage", () => {
    expect(() =>
      assertFileAllowed({ fileUrl: "data:text/plain;base64,aGVsbG8=", mime: "text/plain" }),
    ).toThrow(/isn't accepted/);
    const over = Buffer.alloc(250, 1);
    expect(() =>
      assertFileAllowed({
        fileUrl: `data:image/png;base64,${over.toString("base64")}`,
        mime: "image/png",
        config: { maxBytes: 200 },
      }),
    ).toThrow(/too large/);
  });

  it("legacy data-URL path is capped below the deck cap", () => {
    expect(READINESS_DATA_URL_MAX_BYTES).toBe(20_000_000);
    expect(READINESS_DATA_URL_MAX_BYTES).toBeLessThan(READINESS_DECK_MAX_BYTES);
  });
});

describe("upload-intent meta validation (ER4.3)", () => {
  it("accepts allowed types and sizes within the deck cap", () => {
    const meta = assertUploadMetaAllowed({
      fileName: "deck.pptx",
      mime: "application/octet-stream",
      size: 39_000_000,
    });
    expect(meta.mime).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    expect(meta.sizeBytes).toBe(39_000_000);
  });

  it("rejects wrong type and oversized claims", () => {
    expect(() =>
      assertUploadMetaAllowed({ fileName: "notes.txt", mime: "text/plain", size: 100 }),
    ).toThrow(/isn't accepted/);
    expect(() =>
      assertUploadMetaAllowed({
        fileName: "huge.pdf",
        mime: "application/pdf",
        size: READINESS_DECK_MAX_BYTES + 1,
      }),
    ).toThrow(/too large/);
    expect(() =>
      assertUploadMetaAllowed({
        fileName: "tight.png",
        mime: "image/png",
        size: 250,
        config: { maxBytes: 200 },
      }),
    ).toThrow(/too large/);
  });
});

describe("readiness object key scoping (ER4.3)", () => {
  it("mints keys under events/{eventId}/readiness/{assignmentId}/", () => {
    const key = mintReadinessObjectKey({
      eventId: "evt_1",
      assignmentId: "asg_9",
      mime: "application/pdf",
      fileName: "slides.pdf",
    });
    expect(key.startsWith("events/evt_1/readiness/asg_9/")).toBe(true);
    expect(key.endsWith(".pdf")).toBe(true);
    expect(isReadinessKeyScoped(key, "evt_1", "asg_9")).toBe(true);
  });

  it("rejects forged or cross-assignment keys", () => {
    expect(isReadinessKeyScoped("events/evt_1/readiness/asg_9/abc.pdf", "evt_1", "asg_9")).toBe(true);
    expect(isReadinessKeyScoped("events/evt_1/readiness/asg_OTHER/abc.pdf", "evt_1", "asg_9")).toBe(
      false,
    );
    expect(isReadinessKeyScoped("events/evt_OTHER/readiness/asg_9/abc.pdf", "evt_1", "asg_9")).toBe(
      false,
    );
    expect(isReadinessKeyScoped("events/evt_1/readiness/asg_9/../escape.pdf", "evt_1", "asg_9")).toBe(
      false,
    );
    expect(isReadinessKeyScoped("events/evt_1/readiness/asg_9/nested/path.pdf", "evt_1", "asg_9")).toBe(
      false,
    );
  });
});

describe("readinessFileDisposition (ER4.5)", () => {
  it("serves pdf and png/jpeg inline so the browser can preview", () => {
    expect(readinessFileDisposition("application/pdf")).toBe("inline");
    expect(readinessFileDisposition("image/png")).toBe("inline");
    expect(readinessFileDisposition("image/jpeg")).toBe("inline");
    expect(contentDisposition("deck.pdf", "application/pdf")).toBe('inline; filename="deck.pdf"');
    expect(contentDisposition("shot.PNG", "image/png")).toBe('inline; filename="shot.PNG"');
  });

  it("forces Office and unknown types to download with the real filename", () => {
    expect(
      readinessFileDisposition(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ),
    ).toBe("attachment");
    expect(
      readinessFileDisposition(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe("attachment");
    expect(readinessFileDisposition("application/vnd.ms-powerpoint")).toBe("attachment");
    expect(readinessFileDisposition("application/msword")).toBe("attachment");
    expect(readinessFileDisposition(null)).toBe("attachment");
    expect(readinessFileDisposition("application/octet-stream")).toBe("attachment");
    expect(
      contentDisposition(
        "talk.pptx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ),
    ).toBe('attachment; filename="talk.pptx"');
    expect(
      contentDisposition(
        "notes.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe('attachment; filename="notes.docx"');
  });
});
