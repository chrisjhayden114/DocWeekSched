import { z } from "zod";

/**
 * BRAND-2 — server-side brand color hygiene.
 *
 * brandColor reaches the accent derivation on the web (lib/eventAccent.ts),
 * which silently falls back to the neutral accent on anything it cannot parse.
 * Stored garbage therefore looks like "my color didn't apply" with no
 * explanation, so the server is the honest gate: a value that isn't hex is
 * rejected with a message naming the accepted shapes, and a value that is hex
 * is stored in one canonical form (`#rrggbb`, lowercase, shorthand expanded)
 * so equality checks and dirty-form comparisons are meaningful.
 *
 * `undefined` and `null` are NOT errors — they mean "untouched" and "clear"
 * respectively; deciding between them is the route's job.
 */

export const BRAND_COLOR_MESSAGE =
  "Brand color must be a hex value like #0f766e or #0a7 (3 or 6 hex digits) — leave it empty for the neutral default.";

const HEX_RE = /^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Normalize a submitted brand color to `#rrggbb` lowercase.
 * Returns null for a value that means "no brand color" (null, empty, blank),
 * and throws nothing — invalid input yields `{ ok: false }`.
 */
export function normalizeBrandColor(
  input: string | null | undefined,
): { ok: true; value: string | null } | { ok: false } {
  if (input === null || input === undefined) return { ok: true, value: null };
  const raw = input.trim();
  if (!raw) return { ok: true, value: null };
  if (!HEX_RE.test(raw)) return { ok: false };
  const digits = raw.replace(/^#/, "").toLowerCase();
  const full =
    digits.length === 3
      ? digits
          .split("")
          .map((c) => c + c)
          .join("")
      : digits;
  return { ok: true, value: `#${full}` };
}

/**
 * Zod field for brandColor on the event payloads. Absent stays `undefined`
 * (the transform never runs), so routes can tell "not sent" from "sent as
 * null"; anything present is either normalized or a 400 via the usual
 * validationErrorBody path, keyed to the `brandColor` field.
 */
export const brandColorField = z
  .union([z.string().max(32), z.null()])
  .transform((value, ctx) => {
    const result = normalizeBrandColor(value);
    if (!result.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: BRAND_COLOR_MESSAGE });
      return z.NEVER;
    }
    return result.value;
  })
  .optional();
