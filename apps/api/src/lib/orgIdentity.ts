/**
 * ORG-1 — server side of organization identity.
 *
 * Pure validation lives in @event-app/shared (the settings page pre-checks with
 * the same functions); this module is the request shape and the update the
 * route writes. It holds no prisma import on purpose, so the patch semantics
 * below are unit-testable without a database — which is the whole point of
 * keeping them out of the route body.
 */

import { z } from "zod";
import {
  ORG_DESCRIPTION_MAX_CHARS,
  ORG_LOGO_URL_MAX_CHARS,
  ORG_NAME_MAX_CHARS,
  ORG_NAME_REQUIRED_MESSAGE,
  ORG_SUPPORT_EMAIL_MAX_CHARS,
  ORG_WEBSITE_URL_MAX_CHARS,
  normalizeOrgSupportEmail,
  normalizeOrgWebsiteUrl,
} from "@event-app/shared";
import { patchFields } from "./patchFields";

/**
 * Website/support-email fields, mirroring paymentUrlField: absent stays
 * undefined so the route can tell "not sent" from "sent as null", and anything
 * present is either normalized or a 400 keyed to that field.
 */
export const orgWebsiteUrlField = z
  .union([z.string().max(ORG_WEBSITE_URL_MAX_CHARS), z.null()])
  .transform((value, ctx) => {
    const result = normalizeOrgWebsiteUrl(value);
    if (!result.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.error });
      return z.NEVER;
    }
    return result.value;
  })
  .optional();

export const orgSupportEmailField = z
  .union([z.string().max(ORG_SUPPORT_EMAIL_MAX_CHARS), z.null()])
  .transform((value, ctx) => {
    const result = normalizeOrgSupportEmail(value);
    if (!result.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.error });
      return z.NEVER;
    }
    return result.value;
  })
  .optional();

/** The clearable text columns that need no normalization beyond trimming. */
export const ORG_IDENTITY_PATCH_FIELDS = ["logoUrl", "description"] as const;

/**
 * PUT /organizations/:orgId body. Every key is optional, including the name:
 * the org settings page saves the whole form, but a future partial caller must
 * not erase what it never mentioned (FIX-NULL).
 */
export const orgUpdateSchema = z.object({
  name: z.string().max(ORG_NAME_MAX_CHARS).optional(),
  websiteUrl: orgWebsiteUrlField,
  supportEmail: orgSupportEmailField,
  logoUrl: z.string().max(ORG_LOGO_URL_MAX_CHARS).optional().nullable(),
  description: z.string().max(ORG_DESCRIPTION_MAX_CHARS).optional().nullable(),
});

export type OrgUpdateBody = z.infer<typeof orgUpdateSchema>;

export type OrgIdentityUpdate = {
  name?: string;
  websiteUrl?: string | null;
  supportEmail?: string | null;
  logoUrl?: string | null;
  description?: string | null;
};

/**
 * Build the update from a parsed body, keeping only the keys the client sent.
 *
 * `name` is the one field where blank is not a clear: the column is NOT NULL
 * and an unnamed organization is unusable everywhere it appears, so an emptied
 * name is a 400 rather than a silent no-op.
 */
export function orgIdentityUpdateData(
  parsed: OrgUpdateBody,
): { ok: true; data: OrgIdentityUpdate } | { ok: false; error: string } {
  const data: OrgIdentityUpdate = {};

  if (parsed.name !== undefined) {
    const name = parsed.name.trim();
    if (!name) return { ok: false, error: ORG_NAME_REQUIRED_MESSAGE };
    data.name = name;
  }
  // websiteUrl and supportEmail arrive already normalized (or nulled) from
  // their zod fields, so they bypass patchFields' trimming but keep its
  // contract: still absent when the client said nothing.
  if (parsed.websiteUrl !== undefined) data.websiteUrl = parsed.websiteUrl;
  if (parsed.supportEmail !== undefined) data.supportEmail = parsed.supportEmail;

  return { ok: true, data: { ...data, ...patchFields(parsed, ORG_IDENTITY_PATCH_FIELDS) } };
}

/** Columns the settings page reads back, and the only ones it may write. */
export const ORG_IDENTITY_SELECT = {
  id: true,
  name: true,
  slug: true,
  websiteUrl: true,
  supportEmail: true,
  logoUrl: true,
  description: true,
} as const;
