/**
 * FIX-NULL — one shape for partial updates of nullable text columns.
 *
 * The bug class this closes: a PUT route that builds its update as
 * `field: parsed.data.field?.trim() || null` for every nullable column turns
 * "the client didn't send this" into "the client asked me to erase this". Any
 * caller sending a partial payload — a quick inline edit, a rename, a future
 * integration — silently wipes columns it never mentioned. BRAND-2 fixed this
 * for event branding after organizers lost their logo and colour to a
 * name-only settings save; the same defect was still live on the sibling
 * fields of PUT /event and on every file/link column of PUT /sessions/:id.
 *
 * The contract, everywhere:
 *   ABSENT (key missing, or undefined)  → untouched (key left out of the update)
 *   explicit null, "", or whitespace    → cleared (stored as null)
 *   a non-blank string                  → stored trimmed
 *
 * Absent has to mean untouched rather than clear because it is the only one of
 * the two a partial caller can express by accident. Clearing stays possible,
 * but it has to be asked for.
 */

/** A submitted string where empty, blank, and null all mean "no value". */
export function trimmedOrNull(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

/**
 * Build the nullable-string slice of a Prisma update from a parsed body,
 * keeping only the keys the client actually sent.
 *
 * Pass a zod-parsed object — zod drops absent `.optional()` keys, which is
 * what makes "not sent" distinguishable from "sent as null" in the first
 * place. Spread the result into the update:
 *
 *     data: {
 *       name: parsed.data.name,
 *       ...patchFields(parsed.data, ["description", "venueName"]),
 *     }
 *
 * Values that arrive pre-normalized (e.g. brandColor via `brandColorField`)
 * pass through unchanged — trimming a canonical value is a no-op.
 */
export function patchFields<K extends string>(
  parsed: Partial<Record<K, string | null | undefined>>,
  keys: readonly K[],
): Partial<Record<K, string | null>> {
  const patch: Partial<Record<K, string | null>> = {};
  for (const key of keys) {
    const value = parsed[key];
    if (value === undefined) continue;
    patch[key] = trimmedOrNull(value);
  }
  return patch;
}
