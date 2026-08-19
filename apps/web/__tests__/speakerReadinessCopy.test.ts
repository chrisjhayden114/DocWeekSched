import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { readinessReminderCopy, speakerReadinessPilot } from "@event-app/config";

const PAGE = join(__dirname, "../pages/speaker-readiness.tsx");
const MAIL = join(__dirname, "../../api/src/lib/mail.ts");

describe("Speaker Readiness reminder copy stays in sync (MKT-2)", () => {
  it("pins the ER5 strings the builder and the marketing mock share", () => {
    expect(readinessReminderCopy.subjectDue("DocWeek 2027")).toBe("Reminder: materials due for DocWeek 2027");
    expect(readinessReminderCopy.alreadySent).toBe(
      "Already sent these? Your organizer may still be reviewing — no action needed.",
    );
    expect(readinessReminderCopy.linkExpiryNote).toBe(
      "This link works for 30 days. Links from earlier emails keep working until their own expiry.",
    );
    expect(readinessReminderCopy.itemNoDue).toBe("no due date");
  });

  it("the page and the reminder builder both import readinessReminderCopy", () => {
    const page = readFileSync(PAGE, "utf8");
    const mail = readFileSync(MAIL, "utf8");
    expect(page).toContain("readinessReminderCopy");
    expect(page).toContain("subjectDue");
    expect(page).toContain("alreadySent");
    expect(page).toContain("linkExpiryNote");
    expect(mail).toContain("readinessReminderCopy");
    expect(mail).toContain("subjectDue");
    expect(mail).toContain("alreadySent");
    expect(mail).toContain("linkExpiryNote");
  });

  it("pins the §13.2 concierge-pilot amounts used on the page", () => {
    expect(speakerReadinessPilot.small.priceUsd).toBe(750);
    expect(speakerReadinessPilot.small.presentersApprox).toBe(50);
    expect(speakerReadinessPilot.medium.priceUsd).toBe(1250);
    expect(speakerReadinessPilot.medium.presentersApprox).toBe(150);
    expect(readFileSync(PAGE, "utf8")).toContain("speakerReadinessPilot");
  });
});
