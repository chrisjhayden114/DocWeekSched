function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendParticipantInviteEmail(opts: {
  to: string;
  name: string;
  eventName: string;
  inviteUrl: string;
}): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || "Conference <onboarding@resend.dev>";

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
      subject: `You're invited to ${opts.eventName}`,
      html: `<p>Hi ${escapeHtml(opts.name)},</p>
<p>You've been added to <strong>${escapeHtml(opts.eventName)}</strong> with a starter profile.</p>
<p><a href="${opts.inviteUrl.replace(/"/g, "&quot;")}">Set your password and confirm your profile</a></p>
<p>This setup link does not expire — you can complete it whenever you are ready.</p>
<p>If the button does not work, copy this link into your browser:<br/>${escapeHtml(opts.inviteUrl)}</p>`,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[mail] Resend failed:", res.status, body);
  }
}
