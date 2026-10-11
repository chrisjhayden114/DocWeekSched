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
import {
  DEMO_PRESENTER_PORTAL_TOKEN,
  DEMO_PRESENTER_PORTAL_TOKEN_2,
  resetPublicDemoEvent,
} from "../lib/demoEvent";
import { DEMO_EXPLORERS } from "../lib/demoEvent/fixture";

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
        presenterLinks: {
          maya: `/r/${DEMO_PRESENTER_PORTAL_TOKEN}`,
          jonas: `/r/${DEMO_PRESENTER_PORTAL_TOKEN_2}`,
        },
        explorerAccounts: DEMO_EXPLORERS.map((explorer) => explorer.email),
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
