import { describe, expect, it } from "vitest";
import { buildReadinessReminderEmail } from "../lib/mail";

describe("buildReadinessReminderEmail (ER5)", () => {
  const base = {
    speakerName: "Dr. Ada Keynote",
    eventName: "DocWeek 2027",
    portalUrl: "https://app.example.com/r/abc123token",
    timeZone: "America/New_York",
  };

  const upcoming = buildReadinessReminderEmail({
    ...base,
    items: [
      { label: "Upload slides", dueAt: new Date("2027-02-01T00:00:00Z"), late: false },
      { label: "Short bio", dueAt: null, late: false },
    ],
  });

  it("says due when nothing is late and overdue when something is", () => {
    expect(upcoming.subject).toBe("Reminder: materials due for DocWeek 2027");
    const overdue = buildReadinessReminderEmail({
      ...base,
      items: [{ label: "Upload slides", dueAt: new Date("2027-01-01T00:00:00Z"), late: true }],
    });
    expect(overdue.subject).toBe("Reminder: materials overdue for DocWeek 2027");
    expect(overdue.html).toMatch(/overdue/i);
  });

  it("lists every item with its due date, in the event's timezone", () => {
    expect(upcoming.html).toContain("Upload slides");
    // 2027-02-01T00:00Z is still Jan 31 in New York — a deadline is local.
    expect(upcoming.html).toContain("due Jan 31, 2027");
    expect(upcoming.html).toContain("Short bio");
    expect(upcoming.html).toContain("no due date");
  });

  it("carries the portal link and the honest no-action line", () => {
    expect(upcoming.html).toContain("https://app.example.com/r/abc123token");
    expect(upcoming.html).toContain(
      "Already sent these? Your organizer may still be reviewing — no action needed.",
    );
    expect(upcoming.html).toMatch(/replaces earlier ones and works for 30 days/i);
  });

  it("does not include a tracking pixel", () => {
    expect(upcoming.html).not.toMatch(/<img/i);
    expect(upcoming.html).not.toContain("tracking");
  });

  it("escapes presenter-supplied text", () => {
    const built = buildReadinessReminderEmail({
      ...base,
      speakerName: "<script>alert(1)</script>",
      items: [{ label: "Slides & <b>notes</b>", dueAt: null, late: false }],
    });
    expect(built.html).not.toContain("<script>");
    expect(built.html).toContain("&lt;script&gt;");
    expect(built.html).toContain("Slides &amp; &lt;b&gt;notes&lt;/b&gt;");
  });
});
