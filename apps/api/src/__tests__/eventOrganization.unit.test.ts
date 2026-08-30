import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EVENT_ORGANIZATION_TRANSFER_ERROR,
  eventUpdateIncludesOrganizationId,
} from "../lib/eventOrganization";

describe("W-6 — PUT /event rejects organizationId", () => {
  it("treats a present organizationId as a rejected transfer", () => {
    expect(eventUpdateIncludesOrganizationId({ name: "DocWeek", organizationId: "org_other" })).toBe(
      true,
    );
    expect(eventUpdateIncludesOrganizationId({ name: "DocWeek" })).toBe(false);
    expect(eventUpdateIncludesOrganizationId(null)).toBe(false);
  });

  it("the PUT handler 400s with a clear message", () => {
    const src = readFileSync(join(__dirname, "..", "routes", "event.ts"), "utf8");
    expect(src).toContain("eventUpdateIncludesOrganizationId(req.body)");
    expect(src).toContain("EVENT_ORGANIZATION_TRANSFER_ERROR");
    expect(src).toContain("return res.status(400).json({ error: EVENT_ORGANIZATION_TRANSFER_ERROR })");
    expect(EVENT_ORGANIZATION_TRANSFER_ERROR).toMatch(/can't move to a different organization/);
  });
});
