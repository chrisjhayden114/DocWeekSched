export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  from: string;
  /** Dev/log label when delivery is unavailable. */
  logLabel?: string;
  /** URL to surface for copy-link fallback (invite/reset/verify). */
  copyUrl?: string;
};

export type SendEmailResult = {
  /** True when a provider accepted the message. */
  delivered: boolean;
  /** When not delivered, UI should show copy-link with this URL if present. */
  copyUrl?: string;
  /** Human-readable reason when not delivered (never includes API keys). */
  fallbackMessage?: string;
};

export interface EmailProvider {
  readonly name: string;
  isConfigured(): boolean;
  send(input: SendEmailInput): Promise<SendEmailResult>;
}
