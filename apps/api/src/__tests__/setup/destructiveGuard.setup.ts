/**
 * Vitest setup: refuse to run DB test files against a database that doesn't
 * look local/test. DB tests create and deleteMany fixture rows, and some call
 * resetPublicDemoEvent()/hardDeleteUserAccount() — running them against the
 * hosted (Neon) database would mutate real data.
 *
 * Override for a database you are CERTAIN is safe: ALLOW_DESTRUCTIVE_DB=1.
 */

import { existsSync } from "fs";
import { resolve } from "path";
import dotenv from "dotenv";
import { beforeAll, expect } from "vitest";
import { assertDestructiveAllowed } from "../../lib/destructiveGuard";

for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
  if (existsSync(p)) dotenv.config({ path: p });
}

beforeAll(() => {
  const testPath = expect.getState().testPath ?? "";
  if (!/\.db\.test\./.test(testPath)) return;
  assertDestructiveAllowed("db-tests");
});
