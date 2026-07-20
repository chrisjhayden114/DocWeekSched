/** Replace email addresses in provider error text before logging (never log PII). */
export function redactEmails(text: string): string {
  return text.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[redacted-email]");
}
