function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Build Resend "From" line with optional event context in the display name. */
function buildResendFromLine(contextEventName?: string | null): string {
  const raw = (process.env.RESEND_FROM_EMAIL || "EventPilot <onboarding@resend.dev>").trim();
  const m = raw.match(/^(.*?)\s*<\s*([^>]+)\s*>$/);
  const email = m ? m[2].trim() : raw;
  const displayName = contextEventName?.trim()
    ? `${contextEventName.trim()} — EventPilot`
    : "EventPilot";
  const escaped = displayName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}" <${email}>`;
}

export async function sendParticipantInviteEmail(opts: {
  to: string;
  name: string;
  eventName: string;
  inviteUrl: string;
}): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = buildResendFromLine(opts.eventName);

  if (!key) {
    console.warn("[mail] RESEND_API_KEY is not set. Invite URL for", opts.to, ":", opts.inviteUrl);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [opts.to],
      subject: `${opts.eventName}: invitation (EventPilot)`,
      html: `<p style="font-size:16px;margin:0 0 12px"><strong>${escapeHtml(opts.eventName)}</strong> is using EventPilot for schedules and community features.</p>
<p>Hi ${escapeHtml(opts.name)},</p>
<p>You have been added to <strong>${escapeHtml(opts.eventName)}</strong> with a starter profile.</p>
<p><a href="${opts.inviteUrl.replace(/"/g, "&quot;")}">Set your password and confirm your profile</a></p>
<p>This setup link does not expire — you can complete it whenever you are ready.</p>
<p>If the button does not work, copy this link into your browser:<br/>${escapeHtml(opts.inviteUrl)}</p>
<p style="color:#555;font-size:13px;margin-top:16px">You will see &quot;EventPilot&quot; in the app header — that is the platform name for <strong>${escapeHtml(opts.eventName)}</strong>.</p>`,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[mail] Resend failed:", res.status, body);
  }
}

export async function sendPasswordResetEmail(opts: {
  to: string;
  name: string;
  resetUrl: string;
  eventName?: string | null;
}): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = buildResendFromLine(opts.eventName ?? null);
  const ev = opts.eventName?.trim();

  if (!key) {
    console.warn("[mail] RESEND_API_KEY is not set. Password reset URL for", opts.to, ":", opts.resetUrl);
    return;
  }

  const subject = ev ? `Reset your password — ${ev} (EventPilot)` : "Reset your EventPilot password";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [opts.to],
      subject,
      html: `<p>Hi ${escapeHtml(opts.name)},</p>
${ev ? `<p>This reset is for your EventPilot account related to <strong>${escapeHtml(ev)}</strong>.</p>` : "<p>We received a request to reset your EventPilot password.</p>"}
<p><a href="${opts.resetUrl.replace(/"/g, "&quot;")}">Reset password</a></p>
<p>This link expires in 2 hours. If you did not request this, you can ignore this email.</p>
<p>If the button does not work, copy this link into your browser:<br/>${escapeHtml(opts.resetUrl)}</p>`,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[mail] Resend failed:", res.status, body);
  }
}
