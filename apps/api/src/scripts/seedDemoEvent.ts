/**
 * Seed / reset the public demo event (idempotent).
 * Usage: npx tsx src/scripts/seedDemoEvent.ts
 */

import { existsSync } from "fs";
import { resolve } from "path";
import dotenv from "dotenv";

for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
  if (existsSync(p)) dotenv.config({ path: p });
}

import { assertDestructiveAllowed } from "../lib/destructiveGuard";
import { resetPublicDemoEvent } from "../lib/demoEvent";

async function main() {
  // Fail fast with a clear message before touching the database. The reset
  // itself re-checks; this catches misconfigured .env at the script boundary.
  assertDestructiveAllowed("seed-script");
  const result = await resetPublicDemoEvent();
  console.log(
    JSON.stringify(
      {
        ok: true,
        ...result,
        path: `/e/${result.slug}`,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    const { prisma } = await import("../lib/db");
    await prisma.$disconnect();
  });
