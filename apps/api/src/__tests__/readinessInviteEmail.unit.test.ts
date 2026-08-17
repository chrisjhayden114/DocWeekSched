import { describe, expect, it } from "vitest";
import { buildReadinessInviteEmail } from "../lib/mail";

describe("buildReadinessInviteEmail (ER4)", () => {
  const built = buildReadinessInviteEmail({
    speakerName: "Dr. Ada Keynote",
    eventName: "DocWeek 2027",
    portalUrl: "https://app.example.com/r/abc123token",
    requirementLabels: ["Bio", "Slides"],
    nearestDueAt: new Date("2027-02-01T00:00:00Z"),
  });

  it("uses the materials-needed subject with the event name", () => {
    expect(built.subject).toBe("Materials needed for DocWeek 2027");
  });

  it("includes the portal link, requested items, and the 30-day expiry note", () => {
    expect(built.html).toContain("https://app.example.com/r/abc123token");
    expect(built.html).toContain("Bio");
    expect(built.html).toContain("Slides");
    expect(built.html).toMatch(/30 days/i);
  });

  it("ER5.1 — promises grace for older links instead of killing them", () => {
    expect(built.html).toContain(
      "This link works for 30 days. Links from earlier emails keep working until their own expiry.",
    );
    expect(built.html).not.toMatch(/replaces earlier|no longer work/i);
  });

  it("does not include a tracking pixel", () => {
    expect(built.html).not.toMatch(/<img[^>]+width=["']1["']/i);
    expect(built.html).not.toContain("tracking");
  });
});
