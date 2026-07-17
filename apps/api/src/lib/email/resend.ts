import type { EmailProvider, SendEmailInput, SendEmailResult } from "./types";

export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";

  constructor(private readonly apiKey: string) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: input.from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[mail] Resend failed:", res.status, body.slice(0, 300));
      return {
        delivered: false,
        copyUrl: input.copyUrl,
        fallbackMessage: "Email delivery failed — copy this link instead",
      };
    }
    return { delivered: true };
  }
}
