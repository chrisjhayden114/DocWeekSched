/**
 * CERT-2 — validation and merge for the template's design fields.
 *
 * Split out of the route because these four fields are the one place the
 * certificate editor does NOT full-replace. The rest of a template is small
 * text the editor always resubmits (see the FIX-NULL note on PUT), but
 * `backgroundImageUrl` is a multi-megabyte data URL, so the editor omits it
 * whenever the organizer did not touch the artwork. That means these fields
 * follow the patchFields contract instead:
 *
 *   ABSENT            → untouched
 *   explicit null     → cleared (artwork removed, nameBox back to defaults)
 *   a value           → validated, normalized, stored
 */

import { z } from "zod";
import {
  CERTIFICATE_BACKGROUND_MAX_BYTES,
  CERTIFICATE_BACKGROUND_URL_MAX_CHARS,
  CERTIFICATE_NAME_ALIGNS,
  CERTIFICATE_ORIENTATIONS,
  CERTIFICATE_TEMPLATE_KINDS,
  normalizeCertificateNameBox,
  type CertificateNameBox,
  type CertificateOrientation,
  type CertificateTemplateKind,
} from "@event-app/shared";
import { HttpError } from "../authorization";

export const certificateDesignBodySchema = {
  kind: z.enum(CERTIFICATE_TEMPLATE_KINDS).optional(),
  backgroundImageUrl: z
    .string()
    .max(CERTIFICATE_BACKGROUND_URL_MAX_CHARS)
    .nullable()
    .optional(),
  nameBox: z
    .object({
      yPct: z.number().finite(),
      fontSize: z.number().finite(),
      color: z.string().max(9),
      align: z.enum(CERTIFICATE_NAME_ALIGNS),
    })
    .partial()
    .nullable()
    .optional(),
  orientation: z.enum(CERTIFICATE_ORIENTATIONS).optional(),
};

export type CertificateDesignInput = {
  kind?: CertificateTemplateKind;
  backgroundImageUrl?: string | null;
  nameBox?: Partial<CertificateNameBox> | null;
  orientation?: CertificateOrientation;
};

export type CertificateDesign = {
  kind: CertificateTemplateKind;
  backgroundImageUrl: string | null;
  nameBox: CertificateNameBox;
  orientation: CertificateOrientation;
};

/** The stored row's shape — `nameBox` arrives as an unvalidated Json column. */
export type CertificateDesignRow = Omit<CertificateDesign, "nameBox"> & { nameBox: unknown };

/** What a template with no design fields submitted looks like — today's behaviour. */
export const CERTIFICATE_DESIGN_DEFAULTS: CertificateDesignRow = {
  kind: "TEXT",
  backgroundImageUrl: null,
  nameBox: {},
  orientation: "LANDSCAPE",
};

const DATA_URL_RE = /^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=\s]+)$/i;

/** base64 length → decoded bytes, without allocating the buffer. */
function base64Bytes(base64: string): number {
  const clean = base64.replace(/\s/g, "");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
}

/**
 * The upload must be a PNG or JPEG data URL.
 *
 * An https:// URL is refused rather than accepted-and-ignored: the renderer
 * embeds bytes, so a remote URL would silently produce the built-in layout and
 * the organizer would be left wondering where their design went.
 */
export function validateCertificateBackground(url: string): string {
  const trimmed = url.trim();
  const match = DATA_URL_RE.exec(trimmed);
  if (!match) {
    throw new HttpError(400, {
      error:
        "The certificate background must be a PNG or JPG file you upload. A link to an image hosted elsewhere cannot be used.",
    });
  }
  if (base64Bytes(match[2]!) > CERTIFICATE_BACKGROUND_MAX_BYTES) {
    const mb = Math.round(CERTIFICATE_BACKGROUND_MAX_BYTES / 1_000_000);
    throw new HttpError(400, {
      error: `That background image is larger than ${mb}MB. Export it again at a smaller size.`,
    });
  }
  return trimmed;
}

/**
 * Merge submitted design fields over what is already stored.
 *
 * On create, pass CERTIFICATE_DESIGN_DEFAULTS as `existing`: a client that
 * sends none of these fields gets a TEXT template, which is byte-for-byte the
 * behaviour that shipped before CERT-2.
 */
export function resolveCertificateDesign(
  input: CertificateDesignInput,
  existing: CertificateDesignRow,
): CertificateDesign {
  const kind = input.kind ?? existing.kind;
  const orientation = input.orientation ?? existing.orientation;

  const backgroundImageUrl =
    input.backgroundImageUrl === undefined
      ? existing.backgroundImageUrl
      : input.backgroundImageUrl === null || input.backgroundImageUrl.trim() === ""
        ? null
        : validateCertificateBackground(input.backgroundImageUrl);

  // A partial nameBox patches the stored box field-by-field, so moving the
  // slider does not have to resend the colour. Explicit null resets to defaults.
  const nameBox =
    input.nameBox === undefined
      ? normalizeCertificateNameBox(existing.nameBox)
      : input.nameBox === null
        ? normalizeCertificateNameBox({})
        : normalizeCertificateNameBox({
            ...normalizeCertificateNameBox(existing.nameBox),
            ...input.nameBox,
          });

  // Refused rather than saved-and-broken: an IMAGE_BACKGROUND template with no
  // artwork would render the built-in layout at issue time, which is not what
  // the organizer asked for and they would only find out from the PDF.
  if (kind === "IMAGE_BACKGROUND" && !backgroundImageUrl) {
    throw new HttpError(400, {
      error: "Upload your certificate design before saving this template as an image background.",
    });
  }

  return { kind, backgroundImageUrl, nameBox, orientation };
}
