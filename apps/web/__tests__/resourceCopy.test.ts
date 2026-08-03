import { describe, expect, it } from "vitest";
import { programCopy } from "@event-app/config";

/** Collect every string value in a copy object, recursively. */
function allStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(allStrings);
  }
  return [];
}

describe("resource copy (E12.4)", () => {
  it("shareHint states the real limit in plain English", () => {
    expect(programCopy.resource.shareHint).toContain("4.5 MB");
  });

  it("no program copy string leaks the transport (\"data URL\")", () => {
    for (const s of allStrings(programCopy)) {
      expect(s.toLowerCase()).not.toContain("data url");
      expect(s.toLowerCase()).not.toContain("data-url");
    }
  });
});
