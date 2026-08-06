/**
 * Vitest setup: the skip-vs-fail rule for *.db.test.ts suites (FIX_PLAN E22).
 *
 * Skipping is only legitimate when the developer never asked for DB tests:
 * - DATABASE_URL unset  → the *.db.test.ts files are excluded at the config
 *   level (see vitest.config.ts), with a one-line notice. A contributor
 *   running unit tests does not need a database.
 * - DATABASE_URL set    → DB tests were requested. If the database is
 *   unreachable, auth is rejected, or migrations are missing, every DB suite
 *   FAILS here with a message naming the real cause. It must never be
 *   possible to read that output as a pass.
 *
 * This is the ONLY place that decides skip-vs-fail. Individual test files
 * must not probe connectivity or skip themselves.
 */

import { readdirSync } from "fs";
import { resolve } from "path";
import { beforeAll, expect } from "vitest";

// ---------------------------------------------------------------------------
// Output hygiene: a transitive dependency emits dozens of DEP0169
// (`url.parse()`) DeprecationWarning lines per run, which is exactly why the
// old per-file "— skipping" warnings were invisible. Node registers its
// default warning printer as a listener on the "warning" event; replace it
// with one that drops DEP0169 and prints everything else unchanged.
// ---------------------------------------------------------------------------
process.removeAllListeners("warning");
process.on("warning", (warning: Error & { code?: string }) => {
  if (warning.code === "DEP0169") return;
  const code = warning.code ? ` [${warning.code}]` : "";
  process.stderr.write(`(node:${process.pid})${code} ${warning.name}: ${warning.message}\n`);
});

const CONNECT_TIMEOUT_MS = 20_000;

/** Host/port/database of DATABASE_URL with credentials stripped, for messages. */
function describeTarget(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    const db = url.pathname.replace(/^\//, "").replace(/\?.*$/, "") || "(no database)";
    return `${url.hostname}${url.port ? `:${url.port}` : ""}/${db}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(
      () => rejectPromise(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      },
      (error) => {
        clearTimeout(timer);
        rejectPromise(error);
      },
    );
  });
}

/** First informative line of an error, skipping Prisma's invocation boilerplate. */
function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith("Invalid `prisma.")) ?? "unknown error"
  );
}

/** Human cause for a failed connection attempt, from Prisma's error code. */
function connectionCause(error: unknown): string {
  const prismaError = error as { code?: string; errorCode?: string };
  const code = prismaError?.code ?? prismaError?.errorCode;
  if (code === "P1000") return "the database rejected the credentials (auth failed)";
  if (code === "P1001") return "the database server is unreachable";
  if (code === "P1002") return "the database server was reached but timed out";
  if (code === "P1003") return "the database named in DATABASE_URL does not exist";
  return firstLine(error);
}

function fail(target: string, cause: string, fix: string): never {
  throw new Error(
    [
      "[db-preflight] DB TESTS FAILED TO START — refusing to skip.",
      `  DATABASE_URL is set (target: ${target}), so the *.db.test.ts suites were requested.`,
      `  Cause: ${cause}`,
      `  Fix: ${fix}`,
      "  (To run unit tests only, unset DATABASE_URL.)",
    ].join("\n"),
  );
}

async function runPreflight(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    // vitest.config.ts excludes *.db.test.ts when DATABASE_URL is unset, so
    // this only happens if a db file is forced through some other config.
    throw new Error(
      "[db-preflight] A *.db.test.ts file was collected but DATABASE_URL is not set. " +
        "Set DATABASE_URL to a test database (RUNBOOK §9) or run via vitest.config.ts, " +
        "which skips DB suites when it is unset.",
    );
  }
  const target = describeTarget(databaseUrl);

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    // 1) Connectivity + auth.
    try {
      await withTimeout(prisma.$queryRaw`SELECT 1`, CONNECT_TIMEOUT_MS, "connection attempt");
    } catch (error) {
      fail(
        target,
        `${connectionCause(error)}.`,
        "start the database or correct DATABASE_URL, then re-run.",
      );
    }

    // 2) Migrations. "Cannot connect" and "tables missing" are different
    // actions: the second means run the migrations.
    let applied: string[];
    try {
      const rows = await prisma.$queryRaw<Array<{ migration_name: string }>>`
        SELECT migration_name FROM "_prisma_migrations"
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      `;
      applied = rows.map((row) => row.migration_name);
    } catch {
      fail(
        target,
        "connected, but the _prisma_migrations table is missing — migrations have never been applied to this database.",
        "npx prisma migrate deploy (RUNBOOK §9), then re-run.",
      );
    }

    const migrationsDir = resolve(process.cwd(), "prisma", "migrations");
    const expected = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const missing = expected.filter((name) => !applied.includes(name));
    if (missing.length > 0) {
      fail(
        target,
        `connected, but ${missing.length} of ${expected.length} migrations are not applied ` +
          `(first missing: ${missing[0]}).`,
        "npx prisma migrate deploy (RUNBOOK §9), then re-run.",
      );
    }
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

// One probe per worker process; every *.db.test.ts file in the worker shares
// the verdict. On failure the rejection propagates to each suite's beforeAll,
// failing them all with the same named cause.
let preflight: Promise<void> | undefined;

beforeAll(async () => {
  const testPath = expect.getState().testPath ?? "";
  if (!/\.db\.test\./.test(testPath)) return;
  preflight ??= runPreflight();
  await preflight;
}, CONNECT_TIMEOUT_MS * 2 + 20_000);
