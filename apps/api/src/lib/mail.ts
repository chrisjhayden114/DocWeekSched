import { brand } from "@event-app/config";
import { getEmailProvider, type SendEmailResult } from "./email";

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
}): Promise<SendEmailResult> {
  const from = buildFromLine(opts.eventName);
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
<p style="color:#555;font-size:13px;margin-top:16px">After you finish setup, return to <strong>${escapeHtml(opts.eventName)}</strong> with this event link:<br/><a href="${opts.permanentEventUrl.replace(/"/g, "&quot;")}">${escapeHtml(opts.permanentEventUrl)}</a></p>`,
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
