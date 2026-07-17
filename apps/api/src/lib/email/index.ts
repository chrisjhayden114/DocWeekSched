import { ResendEmailProvider } from "./resend";
import type { EmailProvider } from "./types";
import { UnconfiguredEmailProvider } from "./unconfigured";

export type { EmailProvider, SendEmailInput, SendEmailResult } from "./types";

let cached: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (cached) return cached;
  const key = process.env.RESEND_API_KEY?.trim();
  const name = (process.env.EMAIL_PROVIDER || "").trim().toLowerCase();
  if (key && name !== "none" && name !== "unconfigured") {
    cached = new ResendEmailProvider(key);
    return cached;
  }
  cached = new UnconfiguredEmailProvider();
  return cached;
}

export function resetEmailProviderForTests(): void {
  cached = null;
}

export const EMAIL_COPY_FALLBACK =
  "Email delivery isn't set up — copy this invite link instead";
