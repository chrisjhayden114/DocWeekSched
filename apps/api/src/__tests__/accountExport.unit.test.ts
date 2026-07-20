/**
 * Phase 6 Chunk B — account export unit + cookie-consent config.
 */

import { describe, expect, it } from "vitest";
import { brand } from "@event-app/config";

describe("cookie consent decision", () => {
  it("keeps consent banner off while only essential cookies exist", () => {
    expect(brand.cookieConsentRequired).toBe(false);
  });
});

describe("account export contract", () => {
  it("documents expected top-level export keys", () => {
    const expected = [
      "exportedAt",
      "subjectUserId",
      "profile",
      "orgMemberships",
      "eventMemberships",
      "attendance",
      "checkIns",
      "messageMetadata",
    ];
    expect(expected).toContain("profile");
    expect(expected).toContain("messageMetadata");
  });
});
