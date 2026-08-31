/**
 * ORG-1 (DESIGN_PHASE_J §Org entity) — pure helpers for organization identity,
 * shared by API + web.
 *
 * The organization stopped being a pure billing shell here: it gained a
 * website, a support email, a logo, and a description. What it deliberately did
 * NOT gain is a public page of its own — J-C's verdict was "identity, not
 * billboard", so these four fields exist to answer "who is hosting this, and
 * how do I reach them" on an event page, and to spare an organizer from
 * re-uploading the same logo for every event they run.
 */

export const ORG_NAME_MAX_CHARS = 120;
export const ORG_WEBSITE_URL_MAX_CHARS = 2000;
export const ORG_SUPPORT_EMAIL_MAX_CHARS = 320;
export const ORG_DESCRIPTION_MAX_CHARS = 2000;
/** Same ceiling as an event logo: uploads arrive as resized data URLs. */
export const ORG_LOGO_URL_MAX_CHARS = 12_000_000;

export const ORG_NAME_REQUIRED_MESSAGE = "Your organization needs a name.";

export const ORG_WEBSITE_URL_MESSAGE =
  "The website must be a full http:// or https:// address (for example https://your-school.org) — or leave it empty.";

export const ORG_SUPPORT_EMAIL_MESSAGE =
  "The support email must be a single address people can actually write to (for example events@your-school.org) — or leave it empty.";

/**
 * Who may change the organization's identity. Mirrors the server gate on
 * PUT /organizations/:orgId so the settings page and the route cannot drift:
 * STAFF can see the workspace but not rename it out from under everyone.
 */
export const ORG_IDENTITY_EDIT_ROLES = ["OWNER", "ADMIN"] as const;

export function canEditOrgIdentity(role: string | null | undefined): boolean {
  return Boolean(role) && (ORG_IDENTITY_EDIT_ROLES as readonly string[]).includes(role!);
}

export type NormalizeOrgFieldResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

/** Deliberately not RFC 5322: one @, no spaces, a dotted domain. */
const ORG_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Website as the organizer typed it. A bare domain is the common case
 * ("your-school.org"), so it gets the https:// it meant rather than a scolding;
 * anything that is not http(s) after that is refused, because this value
 * renders as a link on a public page and a `javascript:` URL must never reach
 * the database.
 */
export function normalizeOrgWebsiteUrl(input: string | null | undefined): NormalizeOrgFieldResult {
  if (input == null) return { ok: true, value: null };
  const raw = input.trim();
  if (!raw) return { ok: true, value: null };
  if (raw.length > ORG_WEBSITE_URL_MAX_CHARS) {
    return {
      ok: false,
      error: `The website must be ${ORG_WEBSITE_URL_MAX_CHARS} characters or fewer.`,
    };
  }
  const withProtocol = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    return { ok: false, error: ORG_WEBSITE_URL_MESSAGE };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: ORG_WEBSITE_URL_MESSAGE };
  }
  if (!parsed.hostname || !parsed.hostname.includes(".")) {
    return { ok: false, error: ORG_WEBSITE_URL_MESSAGE };
  }
  return { ok: true, value: withProtocol };
}

/** Support email, lowercased. Blank is a real answer: no contact line is shown. */
export function normalizeOrgSupportEmail(input: string | null | undefined): NormalizeOrgFieldResult {
  if (input == null) return { ok: true, value: null };
  const raw = input.trim();
  if (!raw) return { ok: true, value: null };
  if (raw.length > ORG_SUPPORT_EMAIL_MAX_CHARS) {
    return {
      ok: false,
      error: `The support email must be ${ORG_SUPPORT_EMAIL_MAX_CHARS} characters or fewer.`,
    };
  }
  if (!ORG_EMAIL_RE.test(raw)) {
    return { ok: false, error: ORG_SUPPORT_EMAIL_MESSAGE };
  }
  return { ok: true, value: raw.toLowerCase() };
}

/**
 * Which logo an event actually shows.
 *
 * The event's own mark always wins; the organization's is a fallback for the
 * common case of a school or district that runs several events a year and
 * uploaded its crest once. This is a read-time fallback, never a write: no
 * event row is ever stamped with the org's logo, so changing the org logo
 * updates every event that never chose one, and an event that DID choose one is
 * untouched forever.
 */
export function eventLogoWithOrgFallback(
  eventLogoUrl: string | null | undefined,
  orgLogoUrl: string | null | undefined,
): string | null {
  return eventLogoUrl?.trim() || orgLogoUrl?.trim() || null;
}

/** The host identity a public event page may show. Never the description. */
export type PublicOrgHost = {
  name: string;
  websiteUrl: string | null;
  supportEmail: string | null;
};

/** `mailto:` for the quiet "Contact organizer" link, or null when unreachable. */
export function orgSupportMailto(supportEmail: string | null | undefined): string | null {
  const email = supportEmail?.trim();
  return email ? `mailto:${email}` : null;
}
