import { brand } from "@event-app/config";

/** Profile tab is where message/digest email preferences are saved. */
export const NOTIFICATION_SETTINGS_PATH = "/dashboard?tab=Profile";

export function notificationSettingsUrl(webBaseUrl: string): string {
  return `${webBaseUrl.replace(/\/$/, "")}${NOTIFICATION_SETTINGS_PATH}`;
}

/**
 * RFC 2369 + RFC 8058 headers for recurring (preference-gated) mail.
 * Transactional sends must not include these.
 */
export function listUnsubscribeHeaders(opts: {
  settingsUrl: string;
  mailto?: string;
}): Record<string, string> {
  const mailto = (opts.mailto ?? brand.supportEmail).trim();
  return {
    "List-Unsubscribe": `<mailto:${mailto}>, <${opts.settingsUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

export function notificationSettingsFooterHtml(settingsUrl: string): string {
  const href = settingsUrl.replace(/"/g, "&quot;");
  return `<p style="color:#555;font-size:13px;margin-top:16px"><a href="${href}">Manage notification settings</a></p>`;
}
