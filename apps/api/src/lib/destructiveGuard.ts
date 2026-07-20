/**
 * Guard for destructive database operations: the nightly public-demo reset,
 * the seed:demo script, the account hard-delete job, and DB test fixtures.
 *
 * WHY THIS EXISTS: account deletion and the demo reset are LEGITIMATE in
 * production — the guard is not about production runtime. It exists to stop
 * dev/test processes (a laptop .env pointing at the hosted Neon URL, a test
 * runner, a mistyped seed command) from wiping or mutating real customer data.
 *
 * Rules:
 * - ALLOW_DESTRUCTIVE_DB=1 explicitly overrides everything (dev/test tooling).
 * - NODE_ENV=production allows normal operation on the designated prod
 *   database — EXCEPT for the "db-tests" scope, which must never run against
 *   a database that doesn't look local/test unless explicitly overridden.
 * - Otherwise DATABASE_URL must look like a local or test database.
 */

export type DestructiveScope =
  | "demo-reset"
  | "seed-script"
  | "account-hard-delete"
  | "db-tests";

export class DestructiveGuardError extends Error {
  constructor(scope: DestructiveScope, reason: string) {
    super(
      `Refusing destructive operation "${scope}": ${reason} ` +
        `Set ALLOW_DESTRUCTIVE_DB=1 only if you are CERTAIN this DATABASE_URL is safe to mutate.`,
    );
    this.name = "DestructiveGuardError";
  }
}

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

/** True when DATABASE_URL points at a local or clearly test-only database. */
export function looksLikeLocalOrTestDb(databaseUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    // Unparseable URL: cannot prove it is safe.
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (LOCAL_HOSTNAMES.has(host)) return true;
  if (host.endsWith(".local") || host.endsWith(".localhost")) return true;
  if (host.includes("test")) return true;
  const dbName = url.pathname.replace(/^\//, "").toLowerCase();
  if (/(^|[_-])test($|[_-])|test$/.test(dbName)) return true;
  return false;
}

/**
 * Throws DestructiveGuardError unless this process is allowed to run the
 * given destructive operation against the current DATABASE_URL.
 */
export function assertDestructiveAllowed(scope: DestructiveScope): void {
  if (process.env.ALLOW_DESTRUCTIVE_DB === "1") return;

  // Normal production operation (nightly demo reset, due account deletions)
  // is legitimate on the production database. Test runs never are.
  if (scope !== "db-tests" && process.env.NODE_ENV === "production") return;

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    // Nothing to destroy — any connection attempt will fail on its own.
    return;
  }

  if (looksLikeLocalOrTestDb(databaseUrl)) return;

  throw new DestructiveGuardError(
    scope,
    "DATABASE_URL does not look like a local/test database and this is not a production runtime.",
  );
}
