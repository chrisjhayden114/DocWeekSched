import { describe, expect, it } from "vitest";
import {
  OUTREACH_STARTER_TEMPLATE,
  buildOutreachMailto,
  resolveOutreachMergeFields,
} from "@event-app/shared";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getHelpArticle, helpCategoryLabel } from "../lib/help/articles";
import { formatOutreachClipboard } from "../lib/outreachCompose";

const eventCtx = {
  orgName: "Acme Labs",
  contactName: "Jordan Lee",
  eventName: "Northbridge",
  eventDates: "Sep 1–2",
  eventUrl: "https://readyhall.com/e/northbridge",
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
    expect(body).toContain("https://readyhall.com/e/northbridge");
    expect(body).not.toMatch(/\{orgName\}/);
  });
});

describe("SPX-1 — mailto encoding", () => {
  it("encodes newlines, ampersands, and non-ASCII org names", () => {
    const href = buildOutreachMailto({
      to: "pat@school.example",
      cc: "me@readyhall.com",
      subject: "Ask: München & Friends",
      body: "Line 1\nLine 2 & more\n株式会社北橋",
    });
    expect(href.startsWith("mailto:pat@school.example?")).toBe(true);
    expect(href).toContain(`subject=${encodeURIComponent("Ask: München & Friends")}`);
    expect(href).toContain(`body=${encodeURIComponent("Line 1\nLine 2 & more\n株式会社北橋")}`);
    expect(href).toContain(`cc=${encodeURIComponent("me@readyhall.com")}`);
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
    expect(panel).toContain("Nothing opened?");
    expect(panel).toContain("Set up your email app →");
    expect(panel).toContain("Open Apple Mail once");
    expect(panel).toContain("Settings &gt; Apps &gt; Default apps &gt; Email");
    expect(panel).toContain("Copy email");
    expect(panel).toContain('href="/help/send-sponsor-outreach"');
    expect(panel).not.toMatch(/>\s*Send\s*</);
    expect(panel).not.toMatch(/Resend/);
    expect(panel).not.toMatch(/method:\s*"POST".*\/send/i);
    const anchorsAsButtons = [...panel.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
    expect(anchorsAsButtons).toHaveLength(1);
    expect(anchorsAsButtons[0]).toContain('className="button"');
    expect(anchorsAsButtons[0]).toContain("href={mailto}");
    expect(panel).toContain("<Link href=\"/help/send-sponsor-outreach\">");
  });

  it("the mail-setup disclosure links the organizer help article", () => {
    const article = readFileSync(
      join(__dirname, "../content/help/send-sponsor-outreach.md"),
      "utf8",
    );
    expect(article).toContain("category: organizer");
    expect(article).toContain("Send sponsor outreach from your own email address");
    expect(article).toContain("never sends these emails");
    expect(article).toContain("Sponsors hear from you, not from us");
    expect(article).toContain("{orgName}");
    expect(article).toContain("{contactName}");
    expect(article).toContain("{eventName}");
    expect(article).toContain("{eventDates}");
    expect(article).toContain("{eventUrl}");
    expect(article).toContain("Open in your email app");
    expect(article).toContain("mailto:");
    expect(article).toContain("default email app");
    expect(article).toContain("Settings > Apps > Default apps > Email");
    expect(article).toContain("mail.google.com");
    expect(article).toContain("Copy email");
    const loaded = getHelpArticle("send-sponsor-outreach");
    expect(loaded?.category).toBe("organizer");
    expect(helpCategoryLabel(loaded?.category)).toBe("Organizer");
  });

  it("the templates card explains merge-field fill-in", () => {
    const card = readFileSync(
      join(__dirname, "../components/organizer/OutreachTemplatesCard.tsx"),
      "utf8",
    );
    expect(card).toContain("Write the ask once");
    expect(card).toContain("{merge fields}");
    expect(card).toContain("Write email panel");
  });
});
