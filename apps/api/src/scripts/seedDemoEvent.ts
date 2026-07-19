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

import { resetPublicDemoEvent } from "../lib/demoEvent";

async function main() {
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
