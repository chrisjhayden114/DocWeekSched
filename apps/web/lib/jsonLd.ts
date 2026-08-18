/**
 * HARDEN-1 — safe serialization for schema.org blocks.
 *
 * These payloads are injected with dangerouslySetInnerHTML into a
 * <script type="application/ld+json">. JSON.stringify does not escape "<", so
 * organizer-controlled text (an event name, a venue, a description) containing
 * "</script>" would close the tag early and everything after it would run as
 * live script on a public page. Escaping "<" to its \u003c form keeps the JSON
 * semantically identical while making the tag impossible to break out of.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
