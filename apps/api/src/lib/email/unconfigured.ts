import type { EmailProvider, SendEmailInput, SendEmailResult } from "./types";

const FALLBACK =
  "Email delivery isn't set up — copy this invite link instead";

/**
 * No-op provider used when no API key is configured.
 * Never logs secrets; returns copyUrl for the UI.
 */
export class UnconfiguredEmailProvider implements EmailProvider {
  readonly name = "unconfigured";

  isConfigured(): boolean {
    return false;
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    if (input.copyUrl) {
      console.info(`[mail] Delivery unavailable (${input.logLabel || "email"}). Copy link for ${input.to}`);
    } else {
      console.info(`[mail] Delivery unavailable (${input.logLabel || "email"}) for ${input.to}`);
    }
    return {
      delivered: false,
      copyUrl: input.copyUrl,
      fallbackMessage: FALLBACK,
    };
  }
}
