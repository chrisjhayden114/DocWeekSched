/**
 * Phase 7 Chunk B — no PII (recipient emails) in mail logging (unit).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { UnconfiguredEmailProvider } from "../lib/email/unconfigured";
import { ResendEmailProvider } from "../lib/email/resend";
import { redactEmails } from "../lib/email/redact";

const RECIPIENT = "attendee.pii@example.org";

function loggedText(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((args: unknown[]) => args.map(String).join(" ")).join("\n");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("redactEmails", () => {
  it("replaces email addresses and keeps the rest", () => {
    const out = redactEmails(`{"message":"Invalid to field: ${RECIPIENT}","statusCode":422}`);
    expect(out).not.toContain(RECIPIENT);
    expect(out).toContain("[redacted-email]");
    expect(out).toContain("statusCode");
  });
});

describe("UnconfiguredEmailProvider", () => {
  it("never logs the recipient address", async () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const provider = new UnconfiguredEmailProvider();

    const withLink = await provider.send({
      to: RECIPIENT,
      from: "Product <noreply@example.com>",
      subject: "Invite",
      html: "<p>hi</p>",
      logLabel: "invite",
      copyUrl: "https://app.example.com/setup/token",
    });
    await provider.send({
      to: RECIPIENT,
      from: "Product <noreply@example.com>",
      subject: "Plain",
      html: "<p>hi</p>",
    });

    expect(loggedText(spy)).not.toContain(RECIPIENT);
    // The copy-link fallback for the UI still works.
    expect(withLink.delivered).toBe(false);
    expect(withLink.copyUrl).toBe("https://app.example.com/setup/token");
    expect(withLink.fallbackMessage).toBeTruthy();
  });
});

describe("ResendEmailProvider failure logging", () => {
  it("redacts recipient addresses echoed in provider error bodies", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 422,
        text: async () => `{"message":"Invalid to: ${RECIPIENT}","name":"validation_error"}`,
      })),
    );

    const provider = new ResendEmailProvider("re_test_key");
    const result = await provider.send({
      to: RECIPIENT,
      from: "Product <noreply@example.com>",
      subject: "Invite",
      html: "<p>hi</p>",
    });

    expect(result.delivered).toBe(false);
    const text = loggedText(spy);
    expect(text).not.toContain(RECIPIENT);
    expect(text).toContain("validation_error");

    vi.unstubAllGlobals();
  });
});
