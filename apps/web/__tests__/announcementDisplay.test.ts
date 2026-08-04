import { describe, expect, it } from "vitest";
import { announcementAudienceLabel, announcementExcerpt } from "../lib/announcementDisplay";

describe("announcementAudienceLabel (E16.3)", () => {
  it("labels EVERYONE plainly", () => {
    expect(announcementAudienceLabel({ audience: "EVERYONE" })).toBe("Everyone");
  });

  it("labels roles in plain English, never the raw enum", () => {
    expect(announcementAudienceLabel({ audience: "ROLE", audienceRole: "ATTENDEE" })).toBe("Attendees");
    expect(announcementAudienceLabel({ audience: "ROLE", audienceRole: "SPEAKER" })).toBe("Speakers");
    expect(announcementAudienceLabel({ audience: "ROLE", audienceRole: "ADMIN" })).toBe("Event admins");
  });

  it("names the session for SESSION_JOINERS when available", () => {
    expect(
      announcementAudienceLabel({
        audience: "SESSION_JOINERS",
        session: { title: "Opening Keynote" },
      }),
    ).toBe("Joiners of “Opening Keynote”");
    expect(announcementAudienceLabel({ audience: "SESSION_JOINERS", session: null })).toBe(
      "Joiners of one session",
    );
  });

  it("labels attendance modes", () => {
    expect(announcementAudienceLabel({ audience: "ATTENDANCE_MODE", attendanceMode: "IN_PERSON" })).toBe(
      "In-person attendees",
    );
    expect(announcementAudienceLabel({ audience: "ATTENDANCE_MODE", attendanceMode: "VIRTUAL" })).toBe(
      "Virtual attendees",
    );
  });
});

describe("announcementExcerpt", () => {
  it("returns short bodies unchanged", () => {
    expect(announcementExcerpt("Lunch is served.")).toBe("Lunch is served.");
  });

  it("collapses whitespace and newlines", () => {
    expect(announcementExcerpt("Line one\n\nLine  two")).toBe("Line one Line two");
  });

  it("truncates on a word boundary with an ellipsis", () => {
    const long = "word ".repeat(60).trim();
    const out = announcementExcerpt(long, 50);
    expect(out.length).toBeLessThanOrEqual(51);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toContain("wor…"); // no mid-word cut
  });
});
