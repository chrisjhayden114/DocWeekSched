import { brand } from "@event-app/config";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Build Resend "From" line with optional event context in the display name. */
function buildResendFromLine(contextEventName?: string | null): string {
  const raw = (process.env.RESEND_FROM_EMAIL || `${brand.productName} <onboarding@resend.dev>`).trim();
  const m = raw.match(/^(.*?)\s*<\s*([^>]+)\s*>$/);
  const email = m ? m[2].trim() : raw;
  const displayName = contextEventName?.trim()
    ? `${contextEventName.trim()} — ${brand.productName}`
    : brand.productName;
  const escaped = displayName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}" <${email}>`;
}

async function sendResend(opts: {
  to: string;
  subject: string;
  html: string;
  from: string;
  logLabel: string;
  logUrl?: string;
}): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn(`[mail] RESEND_API_KEY is not set. ${opts.logLabel} for`, opts.to, opts.logUrl ? `:` : "", opts.logUrl || "");
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: opts.from,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[mail] Resend failed:", res.status, body);
  }
}

export async function sendParticipantInviteEmail(opts: {
  to: string;
  name: string;
  eventName: string;
  inviteUrl: string;
  permanentEventUrl: string;
  expiresInDays: number;
}): Promise<void> {
  const from = buildResendFromLine(opts.eventName);
  await sendResend({
    to: opts.to,
    from,
    subject: `${opts.eventName}: invitation (${brand.productName})`,
    logLabel: "Invite URL",
    logUrl: opts.inviteUrl,
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
}): Promise<void> {
  const from = buildResendFromLine(opts.eventName ?? null);
  const ev = opts.eventName?.trim();
  const subject = ev
    ? `Reset your password — ${ev} (${brand.productName})`
    : `Reset your ${brand.productName} password`;

  await sendResend({
    to: opts.to,
    from,
    subject,
    logLabel: "Password reset URL",
    logUrl: opts.resetUrl,
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
}): Promise<void> {
  const from = buildResendFromLine(null);
  await sendResend({
    to: opts.to,
    from,
    subject: `Verify your ${brand.productName} email`,
    logLabel: "Email verification URL",
    logUrl: opts.verifyUrl,
    html: `<p>Hi ${escapeHtml(opts.name)},</p>
<p>Please verify your email for ${escapeHtml(brand.productName)}.</p>
<p><a href="${opts.verifyUrl.replace(/"/g, "&quot;")}">Verify email</a></p>
<p>This link expires in 24 hours.</p>
<p>If the button does not work, copy this link into your browser:<br/>${escapeHtml(opts.verifyUrl)}</p>`,
  });
}
