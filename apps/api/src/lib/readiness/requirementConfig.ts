/**
 * READY-SHARE-1 — the rules for a requirement's `config` JSON blob.
 *
 * `config` has several writers with no shared vocabulary: the Speaker pack
 * seeds `deck`, ops set `maxBytes` / `allowedMimeTypes` by hand for an event
 * that needs a different upload rule, `multi_select` requirements carry
 * `options`, and the organizer's requirement editor owns `shareByDefault`.
 * Both functions here exist so one writer cannot clobber another's key.
 */

import { z } from "zod";

/**
 * The one key the requirement editor writes is typed; everything else passes
 * through untouched. `sharesOnApproval` only honours a real boolean, so a
 * mistyped `"true"` must fail as a 400 rather than persist as a requirement
 * that silently never auto-shares.
 */
export const requirementConfigSchema = z
  .object({ shareByDefault: z.boolean().optional() })
  .passthrough();

/**
 * A `config` PATCH is a MERGE, not a replacement.
 *
 * Sending the whole object back is not an option for a caller that knows about
 * one key: the organizer editor would drop a deck's upload rules every time
 * someone fixed a label's typo, which is exactly why it used to omit `config`
 * altogether and could not persist a share setting at all.
 *
 * The trade is that no caller can DELETE a config key through the API — every
 * writer either sets a value or leaves the key alone. Removing one is a
 * deliberate data fix, not something a form submit should be able to do.
 */
export function mergeRequirementConfig(
  existing: unknown,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const base =
    existing != null && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  return { ...base, ...patch };
}
