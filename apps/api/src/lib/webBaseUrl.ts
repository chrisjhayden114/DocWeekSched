/**
 * The one definition of the public web origin used to build outbound links.
 *
 * It was copied inline in four places, each with its own localhost fallback,
 * which is exactly the shape of thing that gets missed in a domain migration:
 * BRAND-R has to be able to point every emailed link, billing redirect, and
 * printed URL at a new host by setting one variable. `process.env` is read per
 * call rather than at module load so a caller that sets WEB_BASE_URL after
 * import (the test suites do) sees its own value.
 */

/** No trailing slash, so callers can append a path directly. */
export function publicWebBaseUrl(): string {
  return (process.env.WEB_BASE_URL || "http://localhost:3000").trim().replace(/\/$/, "");
}
