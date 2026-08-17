import { describe, expect, it } from "vitest";
import {
  assertFileAllowed,
  fileRulesForRequirement,
  READINESS_DECK_MAX_BYTES,
  READINESS_DEFAULT_MAX_BYTES,
} from "../lib/readiness/files";

describe("readiness file rules (ER4 / O10)", () => {
  it("defaults to the CFP allowlist and 10 MB", () => {
    const rules = fileRulesForRequirement({});
    expect(rules.deck).toBe(false);
    expect(rules.maxBytes).toBe(READINESS_DEFAULT_MAX_BYTES);
    expect(rules.allowedMimeTypes).toContain("application/pdf");
    expect(rules.allowedMimeTypes).toContain(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(rules.allowedMimeTypes).toContain("image/png");
  });

  it("marks deck requirements and raises the cap to the storage limit", () => {
    expect(fileRulesForRequirement({ deck: true }).deck).toBe(true);
    expect(fileRulesForRequirement({ deck: true }).maxBytes).toBe(READINESS_DECK_MAX_BYTES);
    expect(fileRulesForRequirement({ isDeck: true }).deck).toBe(true);
    expect(fileRulesForRequirement({ role: "deck" }).deck).toBe(true);
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
