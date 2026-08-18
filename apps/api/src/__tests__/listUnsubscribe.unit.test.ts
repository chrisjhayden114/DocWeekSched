import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listUnsubscribeHeaders,
  notificationSettingsFooterHtml,
  notificationSettingsUrl,
} from "../lib/email/listUnsubscribe";
import { ResendEmailProvider } from "../lib/email/resend";
import { buildDigestEmail, buildReadinessReminderEmail, buildUnreadMessagesEmail } from "../lib/mail";

const SETTINGS = "https://ukedl.com/dashboard?tab=Profile";

describe("listUnsubscribeHeaders", () => {
  it("includes mailto, settings URL, and one-click Post", () => {
    const headers = listUnsubscribeHeaders({ settingsUrl: SETTINGS, mailto: "support@ukedl.com" });
    expect(headers["List-Unsubscribe"]).toBe(`<mailto:support@ukedl.com>, <${SETTINGS}>`);
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("builds the profile settings URL from the web origin", () => {
    expect(notificationSettingsUrl("https://ukedl.com/")).toBe(SETTINGS);
  });
});

describe("recurring email classes carry unsubscribe headers and footer", () => {
  it("unread-DM", () => {
    const built = buildUnreadMessagesEmail({
      name: "Ada",
      eventName: "DocWeek",
      count: 1,
      lines: ["Sam: hello"],
      dashboardUrl: "https://ukedl.com/dashboard?tab=Messages",
      settingsUrl: SETTINGS,
    });
    expect(built.headers["List-Unsubscribe"]).toContain("mailto:");
    expect(built.headers["List-Unsubscribe"]).toContain(SETTINGS);
    expect(built.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(built.html).toContain("Manage notification settings");
    expect(built.html).toContain(SETTINGS);
  });

  it("digest", () => {
    const built = buildDigestEmail({
      name: "Ada",
      eventName: "DocWeek",
      body: "• Item one",
      dashboardUrl: "https://ukedl.com/dashboard",
      settingsUrl: SETTINGS,
    });
    expect(built.headers).toEqual(listUnsubscribeHeaders({ settingsUrl: SETTINGS }));
    expect(built.html).toContain("Manage notification settings");
  });

  it("readiness reminder", () => {
    const built = buildReadinessReminderEmail({
      speakerName: "Dr. Ada",
      eventName: "DocWeek",
      portalUrl: "https://ukedl.com/r/token",
      timeZone: "UTC",
      settingsUrl: SETTINGS,
      items: [{ label: "Upload slides", dueAt: null, late: false }],
    });
    expect(built.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(built.html).toContain("Manage notification settings");
  });

  it("footer helper is the same line used in templates", () => {
    expect(notificationSettingsFooterHtml(SETTINGS)).toContain("Manage notification settings");
    expect(notificationSettingsFooterHtml(SETTINGS)).toContain(SETTINGS);
  });
});

describe("Resend payload", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("includes List-Unsubscribe headers on the JSON body when provided", async () => {
    const box: { posted: { headers?: Record<string, string> } | null } = { posted: null };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: { body?: string }) => {
        box.posted = JSON.parse(init?.body ?? "{}") as { headers?: Record<string, string> };
        return { ok: true, text: async () => "" };
      }),
    );
    const provider = new ResendEmailProvider("re_test_key");
    await provider.send({
      to: "ada@example.com",
      from: "UKEDL <noreply@example.com>",
      subject: "Digest",
      html: "<p>hi</p>",
      headers: listUnsubscribeHeaders({ settingsUrl: SETTINGS }),
    });
    expect(box.posted?.headers?.["List-Unsubscribe"]).toContain("mailto:");
    expect(box.posted?.headers?.["List-Unsubscribe"]).toContain(SETTINGS);
    expect(box.posted?.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("omits headers on transactional sends that do not pass them", async () => {
    const box: { posted: { headers?: Record<string, string> } | null } = { posted: null };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: { body?: string }) => {
        box.posted = JSON.parse(init?.body ?? "{}") as { headers?: Record<string, string> };
        return { ok: true, text: async () => "" };
      }),
    );
    const provider = new ResendEmailProvider("re_test_key");
    await provider.send({
      to: "ada@example.com",
      from: "UKEDL <noreply@example.com>",
      subject: "Verify",
      html: "<p>hi</p>",
    });
    expect(box.posted).not.toBeNull();
    expect(box.posted?.headers).toBeUndefined();
  });
});
