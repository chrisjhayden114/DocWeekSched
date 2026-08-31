/**
 * ORG-1 — the organization's logo as a wizard PREFILL, never a seed.
 *
 * The BRAND-2 doctrine this follows: a create form may suggest, but the row it
 * creates must only ever hold what the organizer could see in the field and
 * chose to keep. So the org's logo is written into the visible logo field,
 * labelled as a suggestion, and clearable — it is never quietly attached to the
 * event on submit, and the event row is never stamped with a value the
 * organizer never saw. (The read-time fallback in the API is the other half:
 * an event that stays empty still shows the org's mark, without owning it.)
 *
 * `organizerEdited` is what makes "clear it" stick. Once the organizer has
 * touched the logo field at all — typed a URL, uploaded a file, or emptied the
 * box — this helper stops having opinions, so switching organizations can never
 * undo their decision.
 */

export type OrgLogoPrefillInput = {
  /** What the wizard's logo field holds right now. */
  current: string;
  /** The newly selected organization's logo, if it has one. */
  orgLogoUrl: string | null | undefined;
  /** The value this helper last wrote into the field, or null if never. */
  lastPrefill: string | null;
  /** True once the organizer has changed the logo field themselves. */
  organizerEdited: boolean;
};

export type OrgLogoPrefillResult = {
  /** The logo field's next value. */
  logoUrl: string;
  /** The suggestion now sitting in the field, or null when there is none. */
  prefilled: string | null;
};

export function orgLogoPrefill(input: OrgLogoPrefillInput): OrgLogoPrefillResult {
  if (input.organizerEdited) {
    return { logoUrl: input.current, prefilled: input.lastPrefill };
  }
  // Untouched, so the field holds either nothing or an earlier suggestion of
  // ours — both are ours to replace, including with nothing when the newly
  // selected organization has no logo.
  const suggestion = input.orgLogoUrl?.trim() || "";
  return { logoUrl: suggestion, prefilled: suggestion || null };
}
