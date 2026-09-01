import { brand, readinessReminderCopy } from "@event-app/config";
import { certificateVerifyUrl } from "./certificates/verifyUrl";
import { getEmailProvider, type SendEmailResult } from "./email";
import {
  listUnsubscribeHeaders,
  notificationSettingsFooterHtml,
  notificationSettingsUrl,
} from "./email/listUnsubscribe";
import { publicWebBaseUrl } from "./webBaseUrl";

function recurringMailHeaders(): Record<string, string> {
  const settingsUrl = notificationSettingsUrl(publicWebBaseUrl());
  return listUnsubscribeHeaders({ settingsUrl, mailto: brand.supportEmail });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Build Resend "From" line with optional event context in the display name. */
function buildFromLine(contextEventName?: string | null): string {
  const raw = (process.env.RESEND_FROM_EMAIL || `${brand.productName} <onboarding@resend.dev>`).trim();
  const m = raw.match(/^(.*?)\s*<\s*([^>]+)\s*>$/);
  const email = m ? m[2].trim() : raw;
  const displayName = contextEventName?.trim()
    ? `${contextEventName.trim()} — ${brand.productName}`
    : brand.productName;
  const escaped = displayName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}" <${email}>`;
}

export async function sendParticipantInviteEmail(opts: {
  to: string;
  name: string;
  eventName: string;
  inviteUrl: string;
  permanentEventUrl: string;
  expiresInDays: number;
  /** membership.checkInCode — also shown as in-app QR after setup */
  checkInCode?: string | null;
}): Promise<SendEmailResult> {
  const from = buildFromLine(opts.eventName);
  const checkInBlock = opts.checkInCode
    ? `<p style="margin-top:16px"><strong>Your check-in code</strong> (also available as a QR in the app under Profile after you finish setup):<br/><code style="font-size:14px">${escapeHtml(opts.checkInCode)}</code></p>
<p style="color:#555;font-size:13px">Staff will scan your QR at the door — keep this email or open the app.</p>`
    : `<p style="color:#555;font-size:13px;margin-top:16px">After setup, open <strong>Profile</strong> in the app to show your check-in QR at registration.</p>`;

  return getEmailProvider().send({
    to: opts.to,
    from,
    subject: `${opts.eventName}: invitation (${brand.productName})`,
    logLabel: "invite",
    copyUrl: opts.inviteUrl,
    html: `<p style="font-size:16px;margin:0 0 12px"><strong>${escapeHtml(opts.eventName)}</strong> is using ${escapeHtml(brand.productName)} for schedules and community features.</p>
<p>Hi ${escapeHtml(opts.name)},</p>
<p>You have been added to <strong>${escapeHtml(opts.eventName)}</strong> with a starter profile.</p>
<p><a href="${opts.inviteUrl.replace(/"/g, "&quot;")}">Set your password and confirm your profile</a></p>
<p>This setup link expires in ${opts.expiresInDays} days. Your organizer can send a new one if needed.</p>
<p>If the button does not work, copy this link into your browser:<br/>${escapeHtml(opts.inviteUrl)}</p>
<p style="color:#555;font-size:13px;margin-top:16px">After you finish setup, return to <strong>${escapeHtml(opts.eventName)}</strong> with this event link:<br/><a href="${opts.permanentEventUrl.replace(/"/g, "&quot;")}">${escapeHtml(opts.permanentEventUrl)}</a></p>
${checkInBlock}`,
  });
}

export async function sendPasswordResetEmail(opts: {
  to: string;
  name: string;
  resetUrl: string;
  eventName?: string | null;
}): Promise<SendEmailResult> {
  const from = buildFromLine(opts.eventName ?? null);
  const ev = opts.eventName?.trim();
  const subject = ev
    ? `Reset your password — ${ev} (${brand.productName})`
    : `Reset your ${brand.productName} password`;

  return getEmailProvider().send({
    to: opts.to,
    from,
    subject,
    logLabel: "password-reset",
    copyUrl: opts.resetUrl,
    html: `<p>Hi ${escapeHtml(opts.name)},</p>
${ev ? `<p>This reset is for your ${escapeHtml(brand.productName)} account related to <strong>${escapeHtml(ev)}</strong>.</p>` : `<p>We received a request to reset your ${escapeHtml(brand.productName)} password.</p>`}
<p><a href="${opts.resetUrl.replace(/"/g, "&quot;")}">Reset password</a></p>
<p>This link expires in 2 hours. If you did not request this, you can ignore this email.</p>
<p>If the button does not work, copy this link into your browser:<br/>${escapeHtml(opts.resetUrl)}</p>`,
  });
}

export async function sendEmailVerificationEmail(opts: {
  to: string;
  name: string;
  verifyUrl: string;
}): Promise<SendEmailResult> {
  const from = buildFromLine(null);
  return getEmailProvider().send({
    to: opts.to,
    from,
    subject: `Verify your ${brand.productName} email`,
    logLabel: "email-verify",
    copyUrl: opts.verifyUrl,
    html: `<p>Hi ${escapeHtml(opts.name)},</p>
<p>Please verify your email for ${escapeHtml(brand.productName)}.</p>
<p><a href="${opts.verifyUrl.replace(/"/g, "&quot;")}">Verify email</a></p>
<p>This link expires in 24 hours.</p>
<p>If the button does not work, copy this link into your browser:<br/>${escapeHtml(opts.verifyUrl)}</p>`,
  });
}

/** Optional post-issue notice — digest-class, never push. Caller enforces idempotency. */
export async function sendCertificateReadyEmail(opts: {
  to: string;
  name: string;
  eventName: string;
  certificateId: string;
}): Promise<SendEmailResult> {
  const from = buildFromLine(opts.eventName);
  const verifyUrl = certificateVerifyUrl(opts.certificateId);
  return getEmailProvider().send({
    to: opts.to,
    from,
    subject: `Your certificate for ${opts.eventName} is ready`,
    logLabel: "certificate-ready",
    copyUrl: verifyUrl,
    html: `<p>Hi ${escapeHtml(opts.name)},</p>
<p>Your certificate for <strong>${escapeHtml(opts.eventName)}</strong> is ready.</p>
<p><a href="${verifyUrl.replace(/"/g, "&quot;")}">View verification page</a></p>
<p style="color:#555;font-size:13px">Certificate ID: <code>${escapeHtml(opts.certificateId)}</code></p>
<p style="color:#555;font-size:13px">You can also download it from your event profile after the event.</p>`,
  });
}

export function buildUnreadMessagesEmail(opts: {
  name: string;
  eventName: string;
  count: number;
  lines: string[];
  dashboardUrl: string;
  settingsUrl: string;
}): { subject: string; html: string; headers: Record<string, string> } {
  const subject = `${opts.count} new message${opts.count === 1 ? "" : "s"} at ${opts.eventName}`;
  const lineHtml = opts.lines
    .map((line) => `<p style="margin:0 0 8px">${escapeHtml(line)}</p>`)
    .join("");
  const html = `<p>Hi ${escapeHtml(opts.name)},</p>
<p>You have <strong>${opts.count} unread message${opts.count === 1 ? "" : "s"}</strong> at <strong>${escapeHtml(opts.eventName)}</strong>.</p>
${lineHtml}
<p><a href="${opts.dashboardUrl.replace(/"/g, "&quot;")}">Open Messages</a></p>
<p>If the button does not work, copy this link into your browser:<br/>${escapeHtml(opts.dashboardUrl)}</p>
${notificationSettingsFooterHtml(opts.settingsUrl)}`;
  return { subject, html, headers: listUnsubscribeHeaders({ settingsUrl: opts.settingsUrl }) };
}

export async function sendUnreadMessagesEmail(opts: {
  to: string;
  name: string;
  eventName: string;
  count: number;
  lines: string[];
  dashboardUrl: string;
}): Promise<SendEmailResult> {
  const from = buildFromLine(opts.eventName);
  const headers = recurringMailHeaders();
  const built = buildUnreadMessagesEmail({
    name: opts.name,
    eventName: opts.eventName,
    count: opts.count,
    lines: opts.lines,
    dashboardUrl: opts.dashboardUrl,
    settingsUrl: notificationSettingsUrl(publicWebBaseUrl()),
  });
  return getEmailProvider().send({
    to: opts.to,
    from,
    subject: built.subject,
    logLabel: "unread-messages",
    copyUrl: opts.dashboardUrl,
    html: built.html,
    headers,
  });
}

export function buildDigestEmail(opts: {
  name: string;
  eventName: string;
  body: string;
  dashboardUrl: string;
  settingsUrl: string;
}): { subject: string; html: string; headers: Record<string, string> } {
  const subject = `Your daily digest — ${opts.eventName}`;
  const lines = opts.body
    .split("\n")
    .filter(Boolean)
    .map((line) => `<p style="margin:0 0 8px">${escapeHtml(line)}</p>`)
    .join("");
  const html = `<p>Hi ${escapeHtml(opts.name)},</p>
<p>Your daily digest for <strong>${escapeHtml(opts.eventName)}</strong>:</p>
${lines}
<p><a href="${opts.dashboardUrl.replace(/"/g, "&quot;")}">Open ${escapeHtml(brand.productName)}</a></p>
${notificationSettingsFooterHtml(opts.settingsUrl)}`;
  return { subject, html, headers: listUnsubscribeHeaders({ settingsUrl: opts.settingsUrl }) };
}

export async function sendDigestEmail(opts: {
  to: string;
  name: string;
  eventName: string;
  body: string;
  dashboardUrl: string;
}): Promise<SendEmailResult> {
  const from = buildFromLine(opts.eventName);
  const headers = recurringMailHeaders();
  const built = buildDigestEmail({
    name: opts.name,
    eventName: opts.eventName,
    body: opts.body,
    dashboardUrl: opts.dashboardUrl,
    settingsUrl: notificationSettingsUrl(publicWebBaseUrl()),
  });
  return getEmailProvider().send({
    to: opts.to,
    from,
    subject: built.subject,
    logLabel: "digest",
    copyUrl: opts.dashboardUrl,
    html: built.html,
    headers,
  });
}

/**
 * Pure builder — unit-tested for subject, portal link, and the 30-day expiry
 * note. ER5.1: the note no longer claims this link replaces earlier ones,
 * because it does not — the previous link runs out its own clock.
 */
export function buildReadinessInviteEmail(opts: {
  speakerName: string;
  eventName: string;
  portalUrl: string;
  requirementLabels: string[];
  nearestDueAt?: Date | null;
}): { subject: string; html: string } {
  const subject = `Materials needed for ${opts.eventName}`;
  const items =
    opts.requirementLabels.length > 0
      ? `<ul style="padding-left:20px;margin:0 0 16px">${opts.requirementLabels
          .map((label) => `<li>${escapeHtml(label)}</li>`)
          .join("")}</ul>`
      : `<p>Your organizer has asked you to complete a short materials checklist.</p>`;
  const due =
    opts.nearestDueAt && !Number.isNaN(opts.nearestDueAt.getTime())
      ? `<p>The nearest due date is <strong>${escapeHtml(
          opts.nearestDueAt.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          }),
        )}</strong>.</p>`
      : "";
  const html = `<p>Hi ${escapeHtml(opts.speakerName)},</p>
<p><strong>${escapeHtml(opts.eventName)}</strong> needs a few materials from you before the event.</p>
${items}
${due}
<p><a href="${opts.portalUrl.replace(/"/g, "&quot;")}">${readinessReminderCopy.portalCta}</a></p>
<p>${readinessReminderCopy.linkExpiryNote}</p>
<p>${readinessReminderCopy.linkFallback}<br/>${escapeHtml(opts.portalUrl)}</p>`;
  return { subject, html };
}

export async function sendReadinessInviteEmail(opts: {
  to: string;
  speakerName: string;
  eventName: string;
  portalUrl: string;
  requirementLabels: string[];
  nearestDueAt?: Date | null;
}): Promise<SendEmailResult> {
  const from = buildFromLine(opts.eventName);
  const built = buildReadinessInviteEmail(opts);
  return getEmailProvider().send({
    to: opts.to,
    from,
    subject: built.subject,
    logLabel: "readiness-invite",
    copyUrl: opts.portalUrl,
    html: built.html,
  });
}

export type ReadinessReminderItem = {
  label: string;
  dueAt: Date | null;
  late: boolean;
};

/**
 * ER5 — the automatic 7-day / 2-day / overdue reminder. Pure builder so the
 * subject, the item list, and the "no action needed" line are unit-tested.
 * Dates are rendered in the event's timezone: a deadline is a local promise.
 */
export function buildReadinessReminderEmail(opts: {
  speakerName: string;
  eventName: string;
  portalUrl: string;
  items: ReadinessReminderItem[];
  timeZone: string;
  settingsUrl?: string;
}): { subject: string; html: string; headers: Record<string, string> } {
  const anyOverdue = opts.items.some((item) => item.late);
  const subject = anyOverdue
    ? readinessReminderCopy.subjectOverdue(opts.eventName)
    : readinessReminderCopy.subjectDue(opts.eventName);

  const formatDue = (dueAt: Date): string => {
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: opts.timeZone,
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(dueAt);
    } catch {
      return dueAt.toISOString().slice(0, 10);
    }
  };

  const rows = opts.items
    .map((item) => {
      const due = item.dueAt
        ? readinessReminderCopy.itemDue(formatDue(item.dueAt))
        : readinessReminderCopy.itemNoDue;
      const flag = item.late
        ? ` <strong style="color:#b42318">${readinessReminderCopy.itemOverdue}</strong>`
        : "";
      return `<li style="margin:0 0 6px">${escapeHtml(item.label)} — ${escapeHtml(due)}${flag}</li>`;
    })
    .join("");

  const eventHtml = `<strong>${escapeHtml(opts.eventName)}</strong>`;
  const html = `<p>${readinessReminderCopy.greeting(escapeHtml(opts.speakerName))}</p>
<p>${
    anyOverdue
      ? readinessReminderCopy.bodyOverdue(eventHtml)
      : readinessReminderCopy.bodyDue(eventHtml)
  }</p>
<ul style="padding-left:20px;margin:0 0 16px">${rows}</ul>
<p><a href="${opts.portalUrl.replace(/"/g, "&quot;")}">${readinessReminderCopy.portalCta}</a></p>
<p>${readinessReminderCopy.linkExpiryNote}</p>
<p>${readinessReminderCopy.linkFallback}<br/>${escapeHtml(opts.portalUrl)}</p>
<p style="color:#555;font-size:13px;margin-top:16px">${readinessReminderCopy.alreadySent}</p>
${notificationSettingsFooterHtml(
    opts.settingsUrl ?? notificationSettingsUrl(publicWebBaseUrl()),
  )}`;
  return {
    subject,
    html,
    headers: listUnsubscribeHeaders({
      settingsUrl: opts.settingsUrl ?? notificationSettingsUrl(publicWebBaseUrl()),
    }),
  };
}

export async function sendReadinessReminderEmail(opts: {
  to: string;
  speakerName: string;
  eventName: string;
  portalUrl: string;
  items: ReadinessReminderItem[];
  timeZone: string;
}): Promise<SendEmailResult> {
  const from = buildFromLine(opts.eventName);
  const headers = recurringMailHeaders();
  const built = buildReadinessReminderEmail({
    ...opts,
    settingsUrl: notificationSettingsUrl(publicWebBaseUrl()),
  });
  return getEmailProvider().send({
    to: opts.to,
    from,
    subject: built.subject,
    logLabel: "readiness-reminder",
    copyUrl: opts.portalUrl,
    html: built.html,
    headers,
  });
}

export async function sendWaitlistPromotedEmail(opts: {
  to: string;
  name: string;
  sessionTitle: string;
  modeLabel: string;
  holdHours: number;
  holdExpiresAt: Date;
  agendaUrl: string;
}): Promise<SendEmailResult> {
  const from = buildFromLine(null);
  return getEmailProvider().send({
    to: opts.to,
    from,
    subject: `Seat available: ${opts.sessionTitle}`,
    logLabel: "waitlist-promoted",
    copyUrl: opts.agendaUrl,
    html: `<p>Hi ${escapeHtml(opts.name)},</p>
<p>A <strong>${escapeHtml(opts.modeLabel)}</strong> seat opened for <strong>${escapeHtml(opts.sessionTitle)}</strong>.</p>
<p>You have <strong>${opts.holdHours} hours</strong> to confirm on your agenda (hold until ${escapeHtml(opts.holdExpiresAt.toUTCString())}).</p>
<p><a href="${opts.agendaUrl.replace(/"/g, "&quot;")}">Open agenda</a></p>
<p>If you do not confirm in time, the seat will pass to the next person on the waitlist.</p>`,
  });
}
