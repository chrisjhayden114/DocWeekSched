import { describe, expect, it } from "vitest";
import {
  assertFileAllowed,
  fileRulesForRequirement,
  READINESS_DECK_MAX_BYTES,
  READINESS_DEFAULT_MAX_BYTES,
  READINESS_DEFAULT_MIME,
} from "../lib/readiness/files";

describe("readiness file rules (ER4 / O10)", () => {
  it("defaults to the deck allowlist and storage cap (20 MB)", () => {
    const rules = fileRulesForRequirement({});
    expect(rules.maxBytes).toBe(READINESS_DEFAULT_MAX_BYTES);
    expect(rules.maxBytes).toBe(READINESS_DECK_MAX_BYTES);
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
});
