/// <reference types="vitest" />
import { existsSync } from "fs";
import { resolve } from "path";
import dotenv from "dotenv";
import { configDefaults, defineConfig } from "vitest/config";

// Load .env the same way the test setup does, so the skip-vs-fail decision
// below sees the same DATABASE_URL the tests will.
for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
  if (existsSync(p)) dotenv.config({ path: p });
}

// FIX_PLAN E22: skipping DB suites is only legitimate when the developer never
// asked for them. DATABASE_URL unset → exclude *.db.test.ts with a clear
// notice. DATABASE_URL set → they run, and dbPreflight.setup.ts FAILS them
// loudly if the database is unreachable or migrations are missing.
const dbTestsRequested = Boolean(process.env.DATABASE_URL?.trim());
if (!dbTestsRequested) {
  console.warn(
    "[db-preflight] DATABASE_URL is not set — skipping all *.db.test.ts suites (unit tests only). " +
      "Set DATABASE_URL to a test database (RUNBOOK §9) to run them.",
  );
  // env.ts hard-requires DATABASE_URL at import even for unit tests, so give
  // it an inert value — the same trick the CI "checks" job uses. The DB
  // suites are excluded above, so this can never reach a database (port 9 is
  // closed; any accidental connection attempt fails loudly).
  process.env.DATABASE_URL = "postgresql://unit-tests-only:inert@localhost:9/unused";
  // Read by dbPreflight.global.ts to repeat the notice at the end of the run.
  process.env.E22_DB_SUITES_SKIPPED = "1";
} else {
  delete process.env.E22_DB_SUITES_SKIPPED;
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: [...configDefaults.exclude, ...(dbTestsRequested ? [] : ["src/**/*.db.test.ts"])],
    setupFiles: [
      "src/__tests__/setup/destructiveGuard.setup.ts",
      "src/__tests__/setup/dbPreflight.setup.ts",
    ],
    globalSetup: ["src/__tests__/setup/dbPreflight.global.ts"],
    testTimeout: 30_000,
  },
});
