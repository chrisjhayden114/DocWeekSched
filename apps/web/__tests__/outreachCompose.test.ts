import { describe, expect, it } from "vitest";
import {
  OUTREACH_STARTER_TEMPLATE,
  buildOutreachMailto,
  resolveOutreachMergeFields,
} from "@event-app/shared";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatOutreachClipboard } from "../lib/outreachCompose";

const eventCtx = {
  orgName: "Acme Labs",
  contactName: "Jordan Lee",
  eventName: "Northbridge",
  eventDates: "Sep 1–2",
  eventUrl: "https://ukedl.com/e/northbridge",
};

describe("SPX-1 — merge-field resolution", () => {
  it("resolves known fields and leaves unknown tokens literal", () => {
    const text = "Hi {contactName} at {orgName} — {unknown} {eventName}";
    expect(resolveOutreachMergeFields(text, eventCtx)).toBe(
      "Hi Jordan Lee at Acme Labs — {unknown} Northbridge",
    );
    expect(resolveOutreachMergeFields("See {missingField} and {orgName}", eventCtx)).toBe(
      "See {missingField} and Acme Labs",
    );
  });

  it("missing contactName becomes empty, never throws", () => {
    expect(
      resolveOutreachMergeFields("Hello {contactName}, from {orgName}", {
        orgName: eventCtx.orgName,
        eventName: eventCtx.eventName,
        eventDates: eventCtx.eventDates,
        eventUrl: eventCtx.eventUrl,
      }),
    ).toBe("Hello , from Acme Labs");
    expect(resolveOutreachMergeFields("Hello {contactName}, from {orgName}", { ...eventCtx, contactName: null })).toBe(
      "Hello , from Acme Labs",
    );
    expect(resolveOutreachMergeFields("{notAField}", {})).toBe("{notAField}");
  });

  it("starter template resolves against the event without crashing", () => {
    const subject = resolveOutreachMergeFields(OUTREACH_STARTER_TEMPLATE.subject, eventCtx);
    const body = resolveOutreachMergeFields(OUTREACH_STARTER_TEMPLATE.body, eventCtx);
    expect(subject).toContain("Acme Labs");
    expect(subject).toContain("Northbridge");
    expect(body).toContain("Jordan Lee");
    expect(body).toContain("https://ukedl.com/e/northbridge");
    expect(body).not.toMatch(/\{orgName\}/);
  });
});

describe("SPX-1 — mailto encoding", () => {
  it("encodes newlines, ampersands, and non-ASCII org names", () => {
    const href = buildOutreachMailto({
      to: "pat@school.example",
      cc: "me@ukedl.com",
      subject: "Ask: München & Friends",
      body: "Line 1\nLine 2 & more\n株式会社北橋",
    });
    expect(href.startsWith("mailto:pat@school.example?")).toBe(true);
    expect(href).toContain(`subject=${encodeURIComponent("Ask: München & Friends")}`);
    expect(href).toContain(`body=${encodeURIComponent("Line 1\nLine 2 & more\n株式会社北橋")}`);
    expect(href).toContain(`cc=${encodeURIComponent("me@ukedl.com")}`);
    expect(href).toContain("%0A");
    expect(href).toContain("%26");
    expect(href).toContain(encodeURIComponent("München"));
    expect(href).toContain(encodeURIComponent("株式会社北橋"));
  });
});

describe("SPX-1 — copy payload", () => {
  it("joins resolved subject and body", () => {
    expect(formatOutreachClipboard("Hello", "Body line")).toBe("Hello\n\nBody line");
  });
});

describe("SPX-1 — composer is draft-and-copy only", () => {
  it("has no send or Resend control", () => {
    const panel = readFileSync(
      join(__dirname, "../components/organizer/OutreachComposePanel.tsx"),
      "utf8",
    );
    expect(panel).toContain("Open in your email app");
    expect(panel).toContain("Copy email");
    expect(panel).toContain("Mark contacted");
    expect(panel).toContain("Draft with AI");
    expect(panel).toContain("OUTREACH_DOCTRINE");
    expect(panel).not.toMatch(/>\s*Send\s*</);
    expect(panel).not.toMatch(/Resend/);
    expect(panel).not.toMatch(/method:\s*"POST".*\/send/i);
  });
});
