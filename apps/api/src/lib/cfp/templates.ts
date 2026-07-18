/**
 * Merge-field templates for CFP decision emails.
 * Fields: {{submitterName}}, {{title}}, {{eventName}}, {{abstract}}
 */

export function applyMergeFields(
  template: string,
  fields: Record<string, string>,
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    return fields[key] ?? "";
  });
}

export const DEFAULT_ACCEPT_SUBJECT = "Your submission was accepted: {{title}}";
export const DEFAULT_ACCEPT_BODY = `Hi {{submitterName}},

We're pleased to accept your submission “{{title}}” for {{eventName}}.

We'll be in touch with scheduling details soon.

— The organizers`;

export const DEFAULT_REJECT_SUBJECT = "Update on your submission: {{title}}";
export const DEFAULT_REJECT_BODY = `Hi {{submitterName}},

Thank you for submitting “{{title}}” to {{eventName}}. After careful review, we are unable to accept it this time.

We appreciate your interest and hope you'll stay involved.

— The organizers`;

export const DEFAULT_VERIFY_SUBJECT = "Confirm your CFP submission: {{title}}";
export const DEFAULT_VERIFY_BODY_TEXT = (verifyUrl: string, eventName: string, title: string) =>
  `Confirm your abstract submission “${title}” for ${eventName}:\n\n${verifyUrl}\n\nIf you did not submit this, you can ignore this email.`;
